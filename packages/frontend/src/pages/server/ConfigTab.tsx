import { ExternalLink, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, ErrorNotice, Field, LoadingBlock, Notice, Range, Section, Toggle } from '../../components/ui';
import { EULA_URL } from '../../lib/constants';
import { systemApi, serversApi } from '../../lib/endpoints';
import { formatMb } from '../../lib/format';
import { javaFit } from '../../lib/java';
import { ramBounds, validateRam, withMax, withMin } from '../../lib/ram';
import { useRouter } from '../../lib/router';
import type { PropertiesPatch, PropertiesView, RuntimeStatus, ServerView, SystemInfo, TypedProperties, UpdateServerInput } from '../../lib/types';
import { useQuery } from '../../lib/useQuery';
import { useLive } from '../../live/LiveProvider';

type Gamemode = TypedProperties['gamemode'];
type Difficulty = TypedProperties['difficulty'];

// Record types make the compiler flag a new option the backend adds
const GAMEMODE_LABEL: Record<Gamemode, string> = { survival: 'Überleben', creative: 'Kreativ', adventure: 'Abenteuer', spectator: 'Zuschauer' };
const DIFFICULTY_LABEL: Record<Difficulty, string> = { peaceful: 'Friedlich', easy: 'Einfach', normal: 'Normal', hard: 'Schwer' };

interface PropertiesForm {
  port: string;
  gamemode: Gamemode;
  difficulty: Difficulty;
  whitelist: boolean;
  maxPlayers: string;
  viewDistance: string;
  onlineMode: boolean;
  motd: string;
}

const toForm = (properties: TypedProperties): PropertiesForm => ({
  port: String(properties['server-port']),
  gamemode: properties.gamemode,
  difficulty: properties.difficulty,
  whitelist: properties['white-list'],
  maxPlayers: String(properties['max-players']),
  viewDistance: String(properties['view-distance']),
  onlineMode: properties['online-mode'],
  motd: properties.motd,
});

const integerIn = (text: string, min: number, max: number): number | null => {
  if (!/^\d{1,6}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
};

type PropertyErrors = Partial<Record<keyof PropertiesForm, string>>;

export function validateProperties(form: PropertiesForm): PropertyErrors {
  const errors: PropertyErrors = {};
  if (integerIn(form.port, 1, 65535) === null) errors.port = 'Eine Zahl von 1 bis 65535.';
  if (integerIn(form.maxPlayers, 1, 10_000) === null) errors.maxPlayers = 'Eine Zahl von 1 bis 10000.';
  if (integerIn(form.viewDistance, 2, 32) === null) errors.viewDistance = 'Eine Zahl von 2 bis 32.';
  if (form.motd.length > 500) errors.motd = 'Höchstens 500 Zeichen.';
  return errors;
}

export function propertiesPatch(current: TypedProperties, form: PropertiesForm): PropertiesPatch {
  const patch: PropertiesPatch = {};
  const port = integerIn(form.port, 1, 65535);
  const maxPlayers = integerIn(form.maxPlayers, 1, 10_000);
  const viewDistance = integerIn(form.viewDistance, 2, 32);
  if (port !== null && port !== current['server-port']) patch['server-port'] = port;
  if (form.gamemode !== current.gamemode) patch.gamemode = form.gamemode;
  if (form.difficulty !== current.difficulty) patch.difficulty = form.difficulty;
  if (form.whitelist !== current['white-list']) patch['white-list'] = form.whitelist;
  if (maxPlayers !== null && maxPlayers !== current['max-players']) patch['max-players'] = maxPlayers;
  if (viewDistance !== null && viewDistance !== current['view-distance']) patch['view-distance'] = viewDistance;
  if (form.onlineMode !== current['online-mode']) patch['online-mode'] = form.onlineMode;
  if (form.motd !== current.motd) patch.motd = form.motd;
  return patch;
}

function PropertiesSection({ server, view, onSaved }: { server: ServerView; view: PropertiesView; onSaved: (view: PropertiesView, restartRequired: boolean) => void }): ReactNode {
  const [form, setForm] = useState<PropertiesForm>(() => toForm(view.properties));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => setForm(toForm(view.properties)), [view]);

  const errors = validateProperties(form);
  const patch = propertiesPatch(view.properties, form);
  const dirty = Object.keys(patch).length > 0;
  const shown = showErrors ? errors : {};
  const set = <K extends keyof PropertiesForm>(key: K, value: PropertiesForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const save = async (): Promise<void> => {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await serversApi.patchProperties(server.id, patch);
      setSaved(true);
      setShowErrors(false);
      onSaved(result, result.restartRequired);
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };

  const extra = Object.entries(view.extra);
  return (
    <Section
      title="Server-Eigenschaften"
      description={view.exists ? 'Werte aus der server.properties. Kommentare und andere Einträge der Datei bleiben unverändert.' : 'Die Datei server.properties entsteht beim ersten Start. Gespeicherte Werte werden dann angelegt.'}
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Port" error={shown.port}>
            {(props) => <input {...props} className="input num" inputMode="numeric" value={form.port} onChange={(event) => set('port', event.target.value)} />}
          </Field>
          <Field label="Maximale Spielerzahl" error={shown.maxPlayers}>
            {(props) => <input {...props} className="input num" inputMode="numeric" value={form.maxPlayers} onChange={(event) => set('maxPlayers', event.target.value)} />}
          </Field>
          <Field label="Spielmodus">
            {(props) => (
              <select {...props} className="input" value={form.gamemode} onChange={(event) => set('gamemode', event.target.value as Gamemode)}>
                {(Object.keys(GAMEMODE_LABEL) as Gamemode[]).map((key) => (
                  <option key={key} value={key}>
                    {GAMEMODE_LABEL[key]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Schwierigkeit">
            {(props) => (
              <select {...props} className="input" value={form.difficulty} onChange={(event) => set('difficulty', event.target.value as Difficulty)}>
                {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((key) => (
                  <option key={key} value={key}>
                    {DIFFICULTY_LABEL[key]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Sichtweite (Chunks)" error={shown.viewDistance}>
            {(props) => <input {...props} className="input num" inputMode="numeric" value={form.viewDistance} onChange={(event) => set('viewDistance', event.target.value)} />}
          </Field>
        </div>
        <Field label="MOTD (Nachricht in der Serverliste)" error={shown.motd}>
          {(props) => <input {...props} className="input" value={form.motd} onChange={(event) => set('motd', event.target.value)} />}
        </Field>
        <Toggle checked={form.whitelist} onChange={(value) => set('whitelist', value)} label="Whitelist" description="Nur eingetragene Spieler dürfen beitreten." />
        <Toggle
          checked={form.onlineMode}
          onChange={(value) => set('onlineMode', value)}
          label="Online-Modus"
          description="Prüft die Konten bei Mojang. Ausschalten erlaubt jedem, sich unter fremdem Namen anzumelden."
        />
        {extra.length === 0 ? null : (
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-dim">Weitere Einträge der Datei ({extra.length}, nur Anzeige)</summary>
            <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-x-4 gap-y-1 font-mono text-xs">
              {extra.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-dim">{key}</dt>
                  <dd className="truncate" title={value}>{value === '' ? '(leer)' : value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        {error === null ? null : <ErrorNotice error={error} title="Die Eigenschaften wurden nicht gespeichert" />}
        {saved ? <Notice tone="success">Gespeichert.</Notice> : null}
        <Button type="submit" variant="primary" icon={Save} loading={saving} disabled={!dirty}>
          Eigenschaften speichern
        </Button>
      </form>
    </Section>
  );
}

function JvmSection({ server, system, onRescan, rescanning, onSaved }: { server: ServerView; system: SystemInfo | undefined; onRescan: () => void; rescanning: boolean; onSaved: (restartRequired: boolean) => void }): ReactNode {
  const total = system?.totalMemoryMb ?? server.maxRamMb;
  const bounds = ramBounds(Math.max(total, server.maxRamMb));
  const [ram, setRam] = useState({ minRamMb: server.minRamMb, maxRamMb: server.maxRamMb });
  const [aikar, setAikar] = useState(server.useAikarFlags);
  const [javaPath, setJavaPath] = useState(server.javaPath ?? '');
  const [args, setArgs] = useState(server.extraJvmArgs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRam({ minRamMb: server.minRamMb, maxRamMb: server.maxRamMb });
    setAikar(server.useAikarFlags);
    setJavaPath(server.javaPath ?? '');
    setArgs(server.extraJvmArgs);
  }, [server.minRamMb, server.maxRamMb, server.useAikarFlags, server.javaPath, server.extraJvmArgs]);

  const runtimes = system?.javaRuntimes ?? [];
  const requirement = { requiredJavaMajor: server.requiredJavaMajor, loader: server.loader, mcVersion: server.mcVersion };
  const known = runtimes.some((runtime) => runtime.path === javaPath);
  const ramErrors = system === undefined ? {} : validateRam(ram, total);
  const automatic = runtimes.filter((runtime) => javaFit(runtime, requirement).fits).sort((a, b) => a.major - b.major)[0];

  const patch: UpdateServerInput = {};
  if (ram.minRamMb !== server.minRamMb) patch.minRamMb = ram.minRamMb;
  if (ram.maxRamMb !== server.maxRamMb) patch.maxRamMb = ram.maxRamMb;
  if (aikar !== server.useAikarFlags) patch.useAikarFlags = aikar;
  if (javaPath !== (server.javaPath ?? '')) patch.javaPath = javaPath === '' ? null : javaPath;
  if (args !== server.extraJvmArgs) patch.extraJvmArgs = args;
  const dirty = Object.keys(patch).length > 0;
  const touch = (): void => setSaved(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const result = await serversApi.update(server.id, patch);
      setSaved(true);
      onSaved(result.restartRequired);
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Java und Arbeitsspeicher" description="Änderungen wirken erst nach einem Neustart des Servers.">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Range
            label="Minimaler Arbeitsspeicher (-Xms)"
            value={ram.minRamMb}
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            format={formatMb}
            error={ramErrors.minRamMb}
            onChange={(value) => {
              touch();
              setRam((current) => withMin(current, value, bounds));
            }}
          />
          <Range
            label="Maximaler Arbeitsspeicher (-Xmx)"
            value={ram.maxRamMb}
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            format={formatMb}
            error={ramErrors.maxRamMb}
            onChange={(value) => {
              touch();
              setRam((current) => withMax(current, value, bounds));
            }}
          />
        </div>
        {system === undefined ? null : <p className="hint">Der Rechner hat {formatMb(system.totalMemoryMb)} Arbeitsspeicher, davon sind {formatMb(system.freeMemoryMb)} frei.</p>}

        <Toggle
          checked={aikar}
          onChange={(value) => {
            touch();
            setAikar(value);
          }}
          label="Aikar-Flags"
          description="Bewährte Garbage-Collector-Einstellungen für Server mit mehreren Spielern."
        />

        <div className="space-y-2">
          <Field
            label="Java-Laufzeit"
            hint={
              server.requiredJavaMajor === null
                ? 'Die benötigte Java-Version ist noch nicht bekannt.'
                : `Dieser Server benötigt ${javaFit({ major: server.requiredJavaMajor }, requirement).requirement}.${javaPath === '' && automatic !== undefined ? ` Automatisch wird Java ${automatic.major} gewählt.` : ''}`
            }
          >
            {(props) => (
              <select
                {...props}
                className="input"
                value={javaPath}
                onChange={(event) => {
                  touch();
                  setJavaPath(event.target.value);
                }}
              >
                <option value="">Automatisch (passende Version wählen)</option>
                {runtimes.map((runtime) => {
                  const fit = javaFit(runtime, requirement);
                  return (
                    <option key={runtime.path} value={runtime.path}>
                      Java {runtime.major} ({runtime.version}) {fit.fits ? '· passt' : `· passt nicht (${fit.requirement})`}
                    </option>
                  );
                })}
                {javaPath !== '' && !known ? <option value={javaPath}>Eigener Pfad: {javaPath}</option> : null}
              </select>
            )}
          </Field>
          {runtimes.length === 0 && system !== undefined ? <Notice tone="warn">Es wurde keine Java-Installation gefunden. Ohne Java startet der Server nicht.</Notice> : null}
          {javaPath !== '' && known ? <p className="hint break-all">Pfad: {javaPath}</p> : null}
          <Button size="sm" icon={RefreshCw} loading={rescanning} onClick={onRescan}>
            Java erneut suchen
          </Button>
        </div>

        <Field label="Zusätzliche JVM-Argumente" hint="Zum Beispiel -Dfoo=bar. Anführungszeichen schützen Leerzeichen.">
          {(props) => (
            <textarea
              {...props}
              className="input console-body"
              rows={2}
              spellCheck={false}
              maxLength={2000}
              value={args}
              onChange={(event) => {
                touch();
                setArgs(event.target.value);
              }}
            />
          )}
        </Field>

        {error === null ? null : <ErrorNotice error={error} title="Die Einstellungen wurden nicht gespeichert" />}
        {saved ? <Notice tone="success">Gespeichert.</Notice> : null}
        <Button type="submit" variant="primary" icon={Save} loading={saving} disabled={!dirty || Object.keys(ramErrors).length > 0}>
          Java-Einstellungen speichern
        </Button>
      </form>
    </Section>
  );
}

function GeneralSection({ server, onSaved }: { server: ServerView; onSaved: () => void }): ReactNode {
  const [name, setName] = useState(server.name);
  const [eula, setEula] = useState(server.eulaAccepted);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setName(server.name);
    setEula(server.eulaAccepted);
  }, [server.name, server.eulaAccepted]);

  const trimmed = name.trim();
  const nameError = trimmed === '' ? 'Bitte einen Namen eingeben.' : trimmed.length > 60 ? 'Höchstens 60 Zeichen.' : undefined;
  const patch: UpdateServerInput = {};
  if (trimmed !== server.name && nameError === undefined) patch.name = trimmed;
  if (eula !== server.eulaAccepted) patch.eulaAccepted = eula;
  const dirty = Object.keys(patch).length > 0;

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await serversApi.update(server.id, patch);
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Allgemein und EULA">
      <form
        className="space-y-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Name des Servers" error={nameError}>
          {(props) => (
            <input
              {...props}
              className="input"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
            />
          )}
        </Field>
        <div className="space-y-2 rounded-lg border border-line-strong bg-canvas p-3">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Minecraft-EULA</span>
            <span className={server.eulaAccepted ? 'chip chip-ok' : 'chip chip-warn'}>{server.eulaAccepted ? 'Zugestimmt' : 'Nicht zugestimmt'}</span>
          </p>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={eula}
              onChange={(event) => {
                setEula(event.target.checked);
                setSaved(false);
              }}
              className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]"
            />
            <span>
              Ich habe die{' '}
              <a href={EULA_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">
                Minecraft-EULA
                <ExternalLink aria-hidden className="size-3" />
              </a>{' '}
              gelesen und stimme ihr für diesen Server zu.
            </span>
          </label>
          <p className="hint">Ohne Zustimmung startet der Server nicht. Die Anwendung stimmt nie von selbst zu.</p>
        </div>
        {error === null ? null : <ErrorNotice error={error} title="Die Änderung wurde nicht gespeichert" />}
        {saved ? <Notice tone="success">Gespeichert.</Notice> : null}
        <Button type="submit" variant="primary" icon={Save} loading={saving} disabled={!dirty}>
          Speichern
        </Button>
      </form>
    </Section>
  );
}

function DangerSection({ server, status }: { server: ServerView; status: RuntimeStatus }): ReactNode {
  const { navigate } = useRouter();
  const { refresh } = useLive();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = status.state === 'starting' || status.state === 'online' || status.state === 'stopping';
  const installing = server.installState === 'installing';

  const close = (): void => {
    setOpen(false);
    setTyped('');
    setError(null);
  };

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await serversApi.remove(server.id);
      await refresh();
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause);
      setDeleting(false);
    }
  };

  return (
    <Section title="Server löschen" description="Entfernt den Server samt Welt, Mods und Einstellungen von diesem Rechner.">
      {running ? <Notice tone="warn" className="mb-3">Der Server läuft. Zum Löschen muss er zuerst gestoppt werden.</Notice> : null}
      {installing ? <Notice tone="warn" className="mb-3">Die Installation läuft noch. Zum Löschen bitte warten, bis sie beendet ist.</Notice> : null}
      <Button variant="danger" icon={Trash2} disabled={running || installing} onClick={() => setOpen(true)}>
        Server löschen …
      </Button>
      <Dialog
        open={open}
        title="Server endgültig löschen?"
        onClose={close}
        footer={
          <>
            <Button onClick={close}>Abbrechen</Button>
            <Button variant="danger-solid" icon={Trash2} loading={deleting} disabled={typed !== server.name} onClick={() => void remove()}>
              Server und Welt löschen
            </Button>
          </>
        }
      >
        <Notice tone="error" title="Die Welt wird gelöscht">
          Der Server „{server.name}“ und seine Welt werden unwiderruflich gelöscht. Dafür gibt es kein Backup und keinen Papierkorb.
        </Notice>
        <Field label={`Zur Bestätigung den Namen „${server.name}“ eingeben`}>
          {(props) => <input {...props} className="input" value={typed} autoComplete="off" spellCheck={false} onChange={(event) => setTyped(event.target.value)} />}
        </Field>
        {error === null ? null : <ErrorNotice error={error} />}
      </Dialog>
    </Section>
  );
}

export function ConfigTab({ server, status }: { server: ServerView; status: RuntimeStatus }): ReactNode {
  const { state, refresh, setRestartNeeded } = useLive();
  const properties = useQuery((signal) => serversApi.properties(server.id, signal), [server.id]);
  const [rescan, setRescan] = useState(0);
  const system = useQuery((signal) => systemApi.system(rescan > 0, signal), [rescan]);
  const rescanning = system.loading && rescan > 0;

  const afterSave = (restartRequired: boolean): void => {
    if (restartRequired) setRestartNeeded(server.id, true);
    void refresh();
  };
  const view = properties.data;

  return (
    <div className="space-y-4">
      {state.restartNeeded[server.id] === true && status.state !== 'offline' ? (
        <Notice tone="warn" title="Neustart nötig">
          Die Änderungen gelten erst, wenn der Server neu gestartet wurde.
        </Notice>
      ) : null}
      {properties.loading && view === undefined ? (
        <LoadingBlock label="Eigenschaften werden geladen …" />
      ) : properties.error !== null || view === undefined ? (
        <ErrorNotice error={properties.error ?? new Error('Keine Daten.')} title="Die Eigenschaften konnten nicht geladen werden" action={<Button size="sm" onClick={properties.reload}>Erneut versuchen</Button>} />
      ) : (
        <PropertiesSection
          server={server}
          view={view}
          onSaved={(next, restartRequired) => {
            properties.setData(next);
            afterSave(restartRequired);
          }}
        />
      )}
      {system.error !== null ? <ErrorNotice error={system.error} title="Systemdaten (Java, Arbeitsspeicher) fehlen" action={<Button size="sm" onClick={system.reload}>Erneut versuchen</Button>} /> : null}
      <JvmSection server={server} system={system.data} rescanning={rescanning} onRescan={() => setRescan((value) => value + 1)} onSaved={afterSave} />
      <GeneralSection server={server} onSaved={() => void refresh()} />
      <DangerSection server={server} status={status} />
    </div>
  );
}

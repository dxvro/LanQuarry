import { AlertTriangle, ArrowLeft, ArrowRight, Check, ExternalLink, Rocket } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { InstallPanel } from '../components/InstallPanel';
import { LOADER_LABEL } from '../components/status';
import { Button, ErrorNotice, Field, LoadingBlock, Notice, Range, Toggle, cx } from '../components/ui';
import { useLive } from '../live/LiveProvider';
import { EULA_URL } from '../lib/constants';
import { systemApi, serversApi } from '../lib/endpoints';
import { formatMb } from '../lib/format';
import { estimateRequiredJava } from '../lib/java';
import { defaultRam, isRamTight, ramBounds, withMax, withMin } from '../lib/ram';
import { serverPath, useRouter } from '../lib/router';
import type { Loader, LoaderInfo, ServerView } from '../lib/types';
import { useQuery } from '../lib/useQuery';
import { NAME_MAX, WIZARD_STEPS, buildRequest, firstInvalidStep, nextFreePort, validateStep, type WizardDraft, type WizardErrors, type WizardStep } from '../lib/wizard';

const STEP_LABEL: Record<WizardStep, string> = {
  basics: 'Grundlagen',
  version: 'Version',
  resources: 'Ressourcen',
  review: 'Abschluss',
};

const LOADER_HINT: Record<Loader, string> = {
  vanilla: 'Der unveränderte Server von Mojang. Ohne Mods oder Plugins.',
  fabric: 'Leichtgewichtiger Mod-Loader mit schnellen Updates.',
  paper: 'Optimierter Server mit Plugin-Unterstützung (Bukkit/Spigot).',
  neoforge: 'Moderner Mod-Loader für neuere Minecraft-Versionen.',
  forge: 'Klassischer Mod-Loader, auch für ältere Versionen.',
};

function StepIndicator({ current, reached }: { current: WizardStep; reached: number }): ReactNode {
  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-1" aria-label="Schritte">
      {WIZARD_STEPS.map((step, index) => {
        const active = step === current;
        const done = index < reached && !active;
        return (
          <li key={step} aria-current={active ? 'step' : undefined} className={cx('flex items-center gap-2 rounded-full px-3 py-1 text-sm', active ? 'bg-accent text-on-accent font-semibold' : done ? 'bg-raised text-ink' : 'text-faint')}>
            <span className="num grid size-5 place-items-center rounded-full border border-current text-xs">{done ? <Check aria-hidden className="size-3" /> : index + 1}</span>
            {STEP_LABEL[step]}
          </li>
        );
      })}
    </ol>
  );
}

function LoaderChoice({ loaders, value, onChange, error }: { loaders: LoaderInfo[]; value: Loader | null; onChange: (loader: Loader) => void; error: string | undefined }): ReactNode {
  return (
    <fieldset className="space-y-2">
      <legend className="label mb-1.5">Loader</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {loaders.map((loader) => {
          const selected = value === loader.id;
          return (
            <label key={loader.id} className={cx('relative flex cursor-pointer gap-3 rounded-lg border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent', selected ? 'border-accent bg-accent/8' : 'border-line-strong bg-canvas hover:border-faint')}>
              <input type="radio" name="loader" value={loader.id} checked={selected} onChange={() => onChange(loader.id)} className="mt-0.5 size-5 accent-[var(--color-accent)]" />
              <span className="min-w-0">
                <span className="block font-medium">{LOADER_LABEL[loader.id]}</span>
                <span className="hint block">{LOADER_HINT[loader.id]}</span>
                {loader.requiresInstallerJava ? <span className="hint block">Die Installation braucht eine passende Java-Version.</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function EulaLabel(): ReactNode {
  return (
    <>
      Ich habe die{' '}
      <a href={EULA_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">
        Minecraft-EULA
        <ExternalLink aria-hidden className="size-3" />
      </a>{' '}
      gelesen und stimme ihr für diesen Server zu.
    </>
  );
}

export function CreateWizard(): ReactNode {
  const { navigate } = useRouter();
  const { state, refresh } = useLive();
  const existing = state.servers ?? [];

  const loaders = useQuery(() => systemApi.loaders(), []);
  const system = useQuery((signal) => systemApi.system(false, signal), []);
  const total = system.data?.totalMemoryMb ?? 0;

  const [step, setStep] = useState<WizardStep>('basics');
  const [reached, setReached] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [snapshots, setSnapshots] = useState(false);
  const [draft, setDraft] = useState<WizardDraft>({
    name: '',
    loader: null,
    mcVersion: '',
    loaderVersion: '',
    port: '',
    minRamMb: 1024,
    maxRamMb: 2048,
    eulaAccepted: false,
  });
  const [portTouched, setPortTouched] = useState(false);
  const [ramTouched, setRamTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);
  const [created, setCreated] = useState<ServerView | null>(null);

  useEffect(() => {
    document.title = 'Neuer Server · CraftManager';
  }, []);

  // sensible defaults once the facts are known, until the user chooses their own values
  useEffect(() => {
    if (!portTouched && state.servers !== null) setDraft((current) => ({ ...current, port: String(nextFreePort(state.servers ?? [])) }));
  }, [portTouched, state.servers]);
  useEffect(() => {
    if (!ramTouched && total > 0) setDraft((current) => ({ ...current, ...defaultRam(total) }));
  }, [ramTouched, total]);

  const mcVersions = useQuery((signal) => systemApi.mcVersions(draft.loader as Loader, snapshots, signal), [draft.loader, snapshots], draft.loader !== null);
  const needsLoaderVersion = draft.loader !== null && draft.loader !== 'vanilla';
  const loaderVersions = useQuery(
    (signal) => systemApi.loaderVersions(draft.loader as Loader, draft.mcVersion, signal),
    [draft.loader, draft.mcVersion],
    needsLoaderVersion && draft.mcVersion !== '',
  );

  // keep the selection valid when the version lists change underneath it
  useEffect(() => {
    const list = mcVersions.data;
    if (list === undefined) return;
    setDraft((current) => (current.mcVersion !== '' && !list.some((entry) => entry.id === current.mcVersion) ? { ...current, mcVersion: '', loaderVersion: '' } : current));
  }, [mcVersions.data]);
  useEffect(() => {
    const list = loaderVersions.data;
    if (list === undefined) return;
    setDraft((current) => {
      if (list.some((entry) => entry.version === current.loaderVersion)) return current;
      const pick = list.find((entry) => entry.recommended) ?? list.find((entry) => entry.stable) ?? list[0];
      return { ...current, loaderVersion: pick?.version ?? '' };
    });
  }, [loaderVersions.data]);

  const context = useMemo(
    () => ({ totalMemoryMb: total, servers: existing, loaderNeedsVersion: needsLoaderVersion }),
    [total, existing, needsLoaderVersion],
  );
  const errors: WizardErrors = validateStep(step, draft, context);
  const visibleErrors: WizardErrors = showErrors ? errors : {};
  const bounds = ramBounds(total > 0 ? total : 2048);
  const stepIndex = WIZARD_STEPS.indexOf(step);

  const update = (patch: Partial<WizardDraft>): void => setDraft((current) => ({ ...current, ...patch }));

  const goNext = (): void => {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    const next = WIZARD_STEPS[stepIndex + 1];
    if (next !== undefined) {
      setStep(next);
      setReached((value) => Math.max(value, stepIndex + 1));
    }
  };
  const goBack = (): void => {
    setShowErrors(false);
    const previous = WIZARD_STEPS[stepIndex - 1];
    if (previous !== undefined) setStep(previous);
  };

  const create = async (): Promise<void> => {
    const invalid = firstInvalidStep(draft, context);
    if (invalid !== null) {
      setStep(invalid);
      setShowErrors(true);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const server = await serversApi.create(buildRequest(draft));
      setCreated(server);
      void refresh();
    } catch (cause) {
      setCreateError(cause);
    } finally {
      setCreating(false);
    }
  };

  const estimated = draft.mcVersion === '' ? null : estimateRequiredJava(draft.mcVersion);
  const runtimes = system.data?.javaRuntimes;
  const bestJava = runtimes === undefined || runtimes.length === 0 ? null : Math.max(...runtimes.map((runtime) => runtime.major));
  // with automatic installation a missing Java is not a problem; the warning only stays when that is switched off
  const autoJava = system.data?.javaAutoInstall === true;
  const javaMissing = runtimes !== undefined && (runtimes.length === 0 || (estimated !== null && bestJava !== null && bestJava < estimated));

  if (created !== null) {
    const live = existing.find((server) => server.id === created.id) ?? created;
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="text-2xl">
          {live.installState === 'installed' ? `„${live.name}“ ist installiert` : live.installState === 'failed' ? `„${live.name}“: Installation fehlgeschlagen` : `„${live.name}“ wird installiert`}
        </h1>
        <div className="panel space-y-4 p-4 sm:p-5">
          <InstallPanel server={live} onDone={() => navigate(serverPath(live.id, 'config'))} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate(serverPath(live.id))}>Server öffnen</Button>
          <Button variant="ghost" onClick={() => navigate('/')}>
            Zur Übersicht
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-3">
        <h1 className="text-2xl">Neuer Server</h1>
        <StepIndicator current={step} reached={reached} />
      </div>

      {loaders.loading || system.loading ? (
        <LoadingBlock />
      ) : loaders.error !== null || loaders.data === undefined ? (
        <ErrorNotice error={loaders.error ?? new Error('Die Loader konnten nicht geladen werden.')} title="Der Assistent konnte nicht gestartet werden" action={<Button size="sm" onClick={loaders.reload}>Erneut versuchen</Button>} />
      ) : (
        <form
          className="panel space-y-5 p-4 sm:p-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 'review') void create();
            else goNext();
          }}
        >
          {system.error !== null ? <ErrorNotice error={system.error} title="Systemdaten fehlen: die Arbeitsspeicher-Grenze ist unbekannt" action={<Button size="sm" onClick={system.reload}>Erneut versuchen</Button>} /> : null}

          {step === 'basics' ? (
            <>
              <Field label="Name des Servers" error={visibleErrors.name} hint={`Höchstens ${NAME_MAX} Zeichen.`}>
                {(props) => <input {...props} className="input" value={draft.name} maxLength={NAME_MAX + 20} autoFocus autoComplete="off" onChange={(event) => update({ name: event.target.value })} />}
              </Field>
              <LoaderChoice loaders={loaders.data} value={draft.loader} error={visibleErrors.loader} onChange={(loader) => update({ loader, mcVersion: '', loaderVersion: '' })} />
            </>
          ) : null}

          {step === 'version' ? (
            <>
              <Toggle checked={snapshots} onChange={(value) => setSnapshots(value)} label="Snapshots anzeigen" description="Entwicklungsversionen von Minecraft; nicht für dauerhafte Welten gedacht." />
              <Field label="Minecraft-Version" error={visibleErrors.mcVersion}>
                {(props) => (
                  <select {...props} className="input" value={draft.mcVersion} disabled={mcVersions.loading} onChange={(event) => update({ mcVersion: event.target.value, loaderVersion: '' })}>
                    <option value="">{mcVersions.loading ? 'Wird geladen …' : 'Bitte wählen'}</option>
                    {(mcVersions.data ?? []).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.id}
                        {entry.type === 'snapshot' ? ' (Snapshot)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {mcVersions.error === null ? null : <ErrorNotice error={mcVersions.error} action={<Button size="sm" onClick={mcVersions.reload}>Erneut versuchen</Button>} />}
              {needsLoaderVersion ? (
                <Field label={`${draft.loader === null ? 'Loader' : LOADER_LABEL[draft.loader]}-Version`} error={visibleErrors.loaderVersion}>
                  {(props) => (
                    <select {...props} className="input" value={draft.loaderVersion} disabled={loaderVersions.loading || draft.mcVersion === ''} onChange={(event) => update({ loaderVersion: event.target.value })}>
                      <option value="">{draft.mcVersion === '' ? 'Zuerst die Minecraft-Version wählen' : loaderVersions.loading ? 'Wird geladen …' : 'Bitte wählen'}</option>
                      {(loaderVersions.data ?? []).map((entry) => (
                        <option key={entry.version} value={entry.version}>
                          {entry.version}
                          {entry.recommended ? ' (empfohlen)' : entry.stable ? '' : ' (instabil)'}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              ) : draft.loader === 'vanilla' ? (
                <p className="hint">Vanilla braucht keine Loader-Version.</p>
              ) : null}
              {loaderVersions.error === null ? null : <ErrorNotice error={loaderVersions.error} />}
            </>
          ) : null}

          {step === 'resources' ? (
            <>
              <Field label="Server-Port" error={visibleErrors.port} hint="Dieser Port muss in der Firewall freigegeben sein, damit sich Spieler verbinden können.">
                {(props) => (
                  <input
                    {...props}
                    className="input num max-w-40"
                    inputMode="numeric"
                    value={draft.port}
                    onChange={(event) => {
                      setPortTouched(true);
                      update({ port: event.target.value });
                    }}
                  />
                )}
              </Field>
              {total === 0 ? (
                <Notice tone="warn">Der Arbeitsspeicher des Rechners ist unbekannt, die Regler sind deshalb nicht verfügbar.</Notice>
              ) : (
                <div className="space-y-4">
                  <Range
                    label="Minimaler Arbeitsspeicher (-Xms)"
                    value={draft.minRamMb}
                    min={bounds.min}
                    max={bounds.max}
                    step={bounds.step}
                    format={formatMb}
                    error={visibleErrors.minRamMb}
                    onChange={(value) => {
                      setRamTouched(true);
                      update(withMin(draft, value, bounds));
                    }}
                  />
                  <Range
                    label="Maximaler Arbeitsspeicher (-Xmx)"
                    value={draft.maxRamMb}
                    min={bounds.min}
                    max={bounds.max}
                    step={bounds.step}
                    format={formatMb}
                    error={visibleErrors.maxRamMb}
                    onChange={(value) => {
                      setRamTouched(true);
                      update(withMax(draft, value, bounds));
                    }}
                  />
                  <p className="hint">Der Rechner hat {formatMb(total)} Arbeitsspeicher; mehr lässt sich nicht zuweisen.</p>
                  {isRamTight(draft, total) ? <Notice tone="warn">Der Server bekommt mehr als drei Viertel des Arbeitsspeichers. Für Windows und andere Programme bleibt wenig übrig.</Notice> : null}
                </div>
              )}
              {autoJava && javaMissing ? (
                <Notice tone="info" title="Java wird bei Bedarf automatisch installiert">
                  {estimated === null ? 'Eine passende Java-Version' : `Java ${estimated} (oder die passende Version)`} ist auf diesem Rechner nicht vorhanden. CraftManager lädt sie beim Start des Servers bzw. bei der Installation selbst herunter (Eclipse Temurin, nur für CraftManager, ohne Änderung an Windows).
                </Notice>
              ) : autoJava || runtimes === undefined ? null : runtimes.length === 0 ? (
                <Notice tone="warn" title="Keine Java-Installation gefunden">
                  Der Server lässt sich anlegen, aber erst starten, wenn Java installiert ist{estimated === null ? '' : ` (voraussichtlich Java ${estimated} oder neuer)`}.
                </Notice>
              ) : estimated !== null && bestJava !== null && bestJava < estimated ? (
                <Notice tone="warn" title={`Voraussichtlich wird Java ${estimated} benötigt`}>
                  Gefunden wurde nur Java {runtimes.map((runtime) => runtime.major).join(', ')}. Ohne passende Version startet der Server nicht.
                </Notice>
              ) : null}
            </>
          ) : null}

          {step === 'review' ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <dt className="text-dim">Name</dt>
                <dd className="font-medium">{draft.name.trim()}</dd>
                <dt className="text-dim">Loader</dt>
                <dd>{draft.loader === null ? '–' : LOADER_LABEL[draft.loader]}{draft.loaderVersion === '' ? '' : ` ${draft.loaderVersion}`}</dd>
                <dt className="text-dim">Minecraft</dt>
                <dd className="num">{draft.mcVersion}</dd>
                <dt className="text-dim">Port</dt>
                <dd className="num">{draft.port}</dd>
                <dt className="text-dim">Arbeitsspeicher</dt>
                <dd className="num">
                  {formatMb(draft.minRamMb)} bis {formatMb(draft.maxRamMb)}
                </dd>
              </dl>
              <div className="rounded-lg border border-line-strong bg-canvas p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={draft.eulaAccepted} onChange={(event) => update({ eulaAccepted: event.target.checked })} className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]" />
                  <span>
                    <EulaLabel />
                  </span>
                </label>
                <p className="hint mt-2 pl-8">Ohne Zustimmung wird der Server installiert, lässt sich aber nicht starten. Die Zustimmung kann später in der Konfiguration erteilt werden.</p>
              </div>
              {createError === null ? null : <ErrorNotice error={createError} title="Der Server konnte nicht angelegt werden" />}
            </>
          ) : null}

          <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
            <Button icon={ArrowLeft} onClick={goBack} disabled={stepIndex === 0 || creating}>
              Zurück
            </Button>
            {step === 'review' ? (
              <Button type="submit" variant="primary" icon={Rocket} loading={creating}>
                Server anlegen
              </Button>
            ) : (
              <Button type="submit" variant="primary" icon={ArrowRight}>
                Weiter
              </Button>
            )}
          </div>
          {showErrors && Object.keys(errors).length > 0 ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-bad">
              <AlertTriangle aria-hidden className="size-4" />
              Bitte die markierten Felder korrigieren.
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

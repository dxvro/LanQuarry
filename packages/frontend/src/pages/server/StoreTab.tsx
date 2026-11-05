import { ChevronLeft, ChevronRight, Download, Filter, Package, Power, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { LOADER_LABEL } from '../../components/status';
import { Button, EmptyState, ErrorNotice, Field, LoadingBlock, Notice, cx } from '../../components/ui';
import { modsApi } from '../../lib/endpoints';
import { formatCompact, plural } from '../../lib/format';
import { Link, serverPath } from '../../lib/router';
import type { Category, InstallResultView, RuntimeStatus, SearchIndex, ServerView, ToggleView } from '../../lib/types';
import { useQuery } from '../../lib/useQuery';
import { NoModsSupport, contentNames, isLocked } from './ModsTab';

export const PAGE_SIZE = 20;

const SORT_LABEL: Record<SearchIndex, string> = {
  relevance: 'Relevanz',
  downloads: 'Downloads',
  follows: 'Beliebtheit (Follower)',
  newest: 'Neueste',
  updated: 'Zuletzt aktualisiert',
};

const CATEGORY_LABEL: Record<string, string> = {
  adventure: 'Abenteuer',
  cursed: 'Kurioses',
  decoration: 'Dekoration',
  economy: 'Wirtschaft',
  equipment: 'Ausrüstung',
  food: 'Essen',
  'game-mechanics': 'Spielmechanik',
  library: 'Bibliotheken',
  magic: 'Magie',
  management: 'Verwaltung',
  minigame: 'Minispiele',
  mobs: 'Kreaturen',
  optimization: 'Optimierung',
  social: 'Soziales',
  storage: 'Lagerung',
  technology: 'Technik',
  transportation: 'Transport',
  utility: 'Werkzeuge',
  worldgen: 'Weltgenerierung',
};

export function categoryLabel(name: string): string {
  return CATEGORY_LABEL[name] ?? name.replaceAll('-', ' ').replace(/^./, (first) => first.toUpperCase());
}

// Only https images are rendered; anything else is ignored and the fallback tile shows instead.
export function safeIconUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function Icon({ url, title }: { url: string | null; title: string }): ReactNode {
  const [failed, setFailed] = useState(false);
  const safe = safeIconUrl(url);
  // the letter tile sits behind the image, so a slow or broken icon never leaves an empty box
  return (
    <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-raised text-lg font-semibold text-dim">
      <span aria-hidden>{Array.from(title.trim())[0]?.toUpperCase() ?? <Package className="size-5" />}</span>
      {safe === null || failed ? null : (
        <img src={safe} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
      )}
    </span>
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function StoreTab({ server, status }: { server: ServerView; status: RuntimeStatus }): ReactNode {
  const names = contentNames(server);
  const locked = isLocked(status);
  const supported = server.loader !== 'vanilla';
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [index, setIndex] = useState<SearchIndex>('relevance');
  const [offset, setOffset] = useState(0);
  const query = useDebounced(text.trim(), 350);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<unknown>(null);
  const [lastInstall, setLastInstall] = useState<InstallResultView | null>(null);
  const [installedNow, setInstalledNow] = useState<Set<string>>(new Set());
  const [enabling, setEnabling] = useState<string | null>(null);
  const [enabledNow, setEnabledNow] = useState<Set<string>>(new Set());
  const [enableResult, setEnableResult] = useState<ToggleView | null>(null);

  const projectType = server.loader === 'paper' ? 'plugin' : 'mod';
  const categories = useQuery((signal) => modsApi.categories(signal), [], supported);
  const categoryOptions: Category[] = (categories.data ?? []).filter((entry) => entry.project_type === projectType && entry.header === 'categories');

  useEffect(() => setOffset(0), [query, category, index]);

  const results = useQuery(
    (signal) => modsApi.search(server.id, { query, categories: category === '' ? [] : [category], index, limit: PAGE_SIZE, offset }, signal),
    [server.id, query, category, index, offset],
    supported,
  );

  if (!supported) return <NoModsSupport server={server} />;

  const install = async (projectId: string): Promise<void> => {
    setInstalling(projectId);
    setInstallError(null);
    setLastInstall(null);
    try {
      const result = await modsApi.install(server.id, projectId);
      setLastInstall(result);
      setInstalledNow((current) => new Set([...current, ...result.installed.flatMap((mod) => (mod.projectId === null ? [] : [mod.projectId]))]));
    } catch (cause) {
      setInstallError(cause);
    } finally {
      setInstalling(null);
    }
  };

  const enable = async (projectId: string, modId: string): Promise<void> => {
    setEnabling(projectId);
    setInstallError(null);
    setEnableResult(null);
    try {
      const result = await modsApi.setEnabled(server.id, modId, true);
      setEnableResult(result);
      setEnabledNow((current) => new Set([...current, projectId]));
    } catch (cause) {
      setInstallError(cause);
    } finally {
      setEnabling(null);
    }
  };

  const total = results.data?.totalHits ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const loaderText = server.loader === 'paper' ? 'Paper, Spigot und Bukkit' : LOADER_LABEL[server.loader];

  return (
    <div className="space-y-4">
      <Notice tone="info" title={`Nur passende ${names.plural} werden angezeigt`}>
        Die Suche ist fest auf Minecraft {server.mcVersion} und {loaderText} sowie serverseitig nutzbare {names.plural} gefiltert. Dieser Filter lässt sich nicht aufheben, damit nichts installiert wird, was auf „{server.name}“ nicht läuft.
      </Notice>

      {locked ? (
        <Notice tone="warn" title="Installieren ist gesperrt, solange der Server läuft" action={<Link to={serverPath(server.id)} className="link-btn">Zur Konsole und Server stoppen</Link>}>
          Das Ändern von Dateien bei laufendem Server könnte ihn beschädigen (Fehlercode SERVER_RUNNING). Suchen und Ansehen funktioniert weiterhin.
        </Notice>
      ) : null}

      <form role="search" className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem]" onSubmit={(event) => event.preventDefault()}>
        <Field label={`${names.plural} suchen`}>
          {(props) => (
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input {...props} type="search" className="input pl-9" value={text} placeholder="Name oder Stichwort" onChange={(event) => setText(event.target.value)} />
            </div>
          )}
        </Field>
        <Field label="Kategorie">
          {(props) => (
            <select {...props} className="input" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Alle Kategorien</option>
              {categoryOptions.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {categoryLabel(entry.name)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Sortierung">
          {(props) => (
            <select {...props} className="input" value={index} onChange={(event) => setIndex(event.target.value as SearchIndex)}>
              {(Object.keys(SORT_LABEL) as SearchIndex[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABEL[key]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </form>
      {categories.error === null ? null : <p className="hint">Die Kategorien konnten nicht geladen werden; die Suche funktioniert trotzdem.</p>}

      {installError === null ? null : <ErrorNotice error={installError} title={`${names.singular} nicht installiert oder aktiviert`} />}
      {enableResult === null ? null : (
        <Notice tone={enableResult.dependencies.length > 0 ? 'warn' : 'success'} title={`„${enableResult.mod.name}“ ist jetzt aktiv`}>
          {enableResult.dependencies.length === 0 ? null : <p>Zusätzlich aktiviert, weil benötigt: {enableResult.dependencies.map((dependency) => dependency.name).join(', ')}.</p>}
        </Notice>
      )}
      {lastInstall === null ? null : (
        <Notice tone={lastInstall.warnings.length > 0 ? 'warn' : 'success'} title={`${plural(lastInstall.installed.length, 'Datei', 'Dateien')} installiert`}>
          <ul className="list-disc pl-5">
            {lastInstall.installed.map((mod) => (
              <li key={mod.id}>
                {mod.name}
                {mod.versionNumber === null ? '' : ` ${mod.versionNumber}`} {mod.isDependency ? <span className="chip">Abhängigkeit</span> : <span className="chip chip-ok">Direkt</span>}
              </li>
            ))}
          </ul>
          {lastInstall.reenabled.length === 0 ? null : <p className="mt-1">Wieder aktiviert, weil benötigt: {lastInstall.reenabled.map((mod) => mod.name).join(', ')}.</p>}
          {lastInstall.warnings.length === 0 ? null : (
            <div className="mt-2">
              <p className="font-medium text-ink">Warnungen</p>
              <ul className="list-disc pl-5">
                {lastInstall.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </Notice>
      )}

      <div aria-live="polite">
        {results.loading ? (
          <LoadingBlock label="Suche läuft …" />
        ) : results.error !== null ? (
          <ErrorNotice error={results.error} title="Die Suche ist fehlgeschlagen" action={<Button size="sm" onClick={results.reload}>Erneut versuchen</Button>} />
        ) : results.data === undefined || results.data.hits.length === 0 ? (
          <EmptyState icon={Filter} title="Keine Treffer">
            <p>Für diese Suche gibt es nichts, das zu Minecraft {server.mcVersion} und {loaderText} passt. Eine andere Kategorie oder ein anderes Stichwort kann helfen.</p>
          </EmptyState>
        ) : (
          <>
            <p className="num hint mb-2">{plural(total, 'Treffer', 'Treffer')}</p>
            <ul className="space-y-2">
              {results.data.hits.map((hit) => {
                const installed = hit.installed || installedNow.has(hit.projectId);
                const switchedOff = hit.installed && !hit.enabled && !enabledNow.has(hit.projectId) && hit.modId !== null;
                return (
                  <li key={hit.projectId} className="panel flex flex-wrap gap-3 p-3 sm:flex-nowrap">
                    <Icon url={hit.iconUrl} title={hit.title} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{hit.title}</span>
                        <span className="text-sm text-dim">von {hit.author}</span>
                      </p>
                      <p className="line-clamp-2 text-dim">{hit.description}</p>
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="num chip">
                          <Download aria-hidden className="size-3" />
                          {formatCompact(hit.downloads)}
                        </span>
                        {hit.categories.slice(0, 4).map((entry) => (
                          <span key={entry} className="chip">
                            {categoryLabel(entry)}
                          </span>
                        ))}
                      </p>
                    </div>
                    <div className="flex w-full items-center sm:w-auto sm:items-start">
                      {switchedOff ? (
                        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-col sm:items-end">
                          <span className="chip chip-warn" aria-label={`${hit.title} ist installiert, aber deaktiviert`}>
                            Deaktiviert
                          </span>
                          <Button
                            size="sm"
                            icon={Power}
                            loading={enabling === hit.projectId}
                            disabled={locked || enabling !== null}
                            title={locked ? 'Gesperrt, solange der Server läuft' : undefined}
                            aria-label={`${hit.title} aktivieren`}
                            onClick={() => void enable(hit.projectId, hit.modId ?? '')}
                          >
                            Aktivieren
                          </Button>
                        </div>
                      ) : installed ? (
                        <span className="chip chip-ok" aria-label={`${hit.title} ist installiert`}>
                          Installiert
                        </span>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={Download}
                          className="w-full sm:w-auto"
                          loading={installing === hit.projectId}
                          disabled={locked || installing !== null}
                          title={locked ? 'Gesperrt, solange der Server läuft' : undefined}
                          aria-label={`${hit.title} installieren`}
                          onClick={() => void install(hit.projectId)}
                        >
                          Installieren
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <nav aria-label="Seiten" className={cx('mt-4 flex items-center justify-between gap-3', pages === 1 && 'hidden')}>
              <Button icon={ChevronLeft} disabled={page <= 1} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>
                Zurück
              </Button>
              <span className="num text-dim">
                Seite {page} von {pages}
              </span>
              <Button disabled={page >= pages || offset + PAGE_SIZE > 10_000} onClick={() => setOffset((value) => value + PAGE_SIZE)}>
                Weiter
                <ChevronRight aria-hidden className="size-4" />
              </Button>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}

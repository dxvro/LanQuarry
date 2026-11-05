import { Download, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { JavaProgress } from '../../components/JavaProgress';
import { Button, ErrorNotice, Notice, Section, cx } from '../../components/ui';
import { systemApi } from '../../lib/endpoints';
import { formatBytes, formatDateTime } from '../../lib/format';
import { installMajorFor } from '../../lib/java';
import type { JavaRuntime, ManagedJavaDto, ServerView, SystemInfo } from '../../lib/types';
import { useLive } from '../../live/LiveProvider';

export const SOURCE_LABEL: Record<JavaRuntime['source'], string> = {
  JAVA_HOME: 'Umgebungsvariable JAVA_HOME',
  PATH: 'Suchpfad (PATH)',
  standard: 'Standard-Installationsordner',
  manual: 'Vom Server eingestellt',
  managed: 'Von CraftManager installiert',
};

const OFFERED_MAJORS = [8, 17, 21, 25];

interface Props {
  server: ServerView;
  system: SystemInfo;
  serverNames: ReadonlyMap<string, string>;
  onChanged: () => void;
}

// Everything about the Java versions the app can use: what was found, where it comes from, and the manual
// "install" and "remove" actions for the runtimes CraftManager manages itself.
export function JavaRuntimes({ server, system, serverNames, onChanged }: Props): ReactNode {
  const { state } = useLive();
  const [installing, setInstalling] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ManagedJavaDto | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<unknown>(null);

  const managed = new Map(system.managedJava.map((entry) => [entry.javaPath, entry]));
  const installed = new Set(system.managedJava.map((entry) => entry.major));
  const needed = server.requiredJavaMajor === null ? null : installMajorFor(server.requiredJavaMajor, server.loader === 'forge' && server.requiredJavaMajor <= 8 ? 8 : null);
  const offers = [...new Set([...(needed === null ? [] : [needed]), ...OFFERED_MAJORS])].filter((major) => !installed.has(major)).sort((a, b) => a - b);
  const running = new Set<number>([...system.javaInstalls.map((entry) => entry.major), ...Object.entries(state.javaInstalls).filter(([, value]) => value.state === 'running').map(([major]) => Number(major))]);

  const install = async (major: number): Promise<void> => {
    setInstalling(major);
    setError(null);
    setNotice(null);
    try {
      const result = await systemApi.installJava(major);
      setNotice(result.alreadyInstalled ? `Java ${major} war schon installiert.` : `Java ${major} wurde installiert.`);
      onChanged();
    } catch (cause) {
      setError(cause);
    } finally {
      setInstalling(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (removeTarget === null) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await systemApi.removeJava(removeTarget.major);
      setNotice(`Java ${removeTarget.major} wurde entfernt.`);
      setRemoveTarget(null);
      onChanged();
    } catch (cause) {
      setRemoveError(cause);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Section
      title="Java-Laufzeiten"
      description={
        system.javaAutoInstall
          ? 'Fehlt für einen Server die passende Java-Version, installiert CraftManager sie beim Start oder bei der Installation selbst (Eclipse Temurin). Das Abschalten geht mit JAVA_AUTO_INSTALL=false.'
          : 'Die automatische Installation ist abgeschaltet (JAVA_AUTO_INSTALL=false). Fehlt die passende Java-Version, scheitert der Start; sie lässt sich hier von Hand installieren.'
      }
    >
      <div className="space-y-4">
        {system.javaRuntimes.length === 0 ? (
          <Notice tone={system.javaAutoInstall ? 'info' : 'warn'} title="Keine Java-Installation gefunden">
            {system.javaAutoInstall ? 'Beim ersten Start wird die benötigte Version automatisch installiert.' : 'Ohne Java startet kein Server. Bitte unten eine Version installieren oder Java selbst installieren.'}
          </Notice>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Gefundene Java-Laufzeiten">
            {system.javaRuntimes.map((runtime) => {
              const entry = managed.get(runtime.path);
              const users = entry?.inUseBy.map((id) => serverNames.get(id) ?? id) ?? [];
              return (
                <li key={runtime.path} className="space-y-1.5 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Java {runtime.major}</span>
                    <span className="num text-sm text-dim">{runtime.version}</span>
                    <span className={cx('chip', runtime.source === 'managed' && 'chip-accent')}>{SOURCE_LABEL[runtime.source]}</span>
                    {entry === undefined ? null : <span className="chip">{entry.image === 'jre' ? 'JRE' : 'JDK'}</span>}
                    {entry === undefined ? null : <span className="num hint">{formatBytes(entry.sizeBytes)}</span>}
                    {entry === undefined ? null : (
                      <Button
                        size="sm"
                        variant="danger"
                        icon={Trash2}
                        className="ml-auto"
                        disabled={users.length > 0}
                        title={users.length > 0 ? `Wird von ${users.join(', ')} verwendet` : `Java ${entry.major} entfernen`}
                        onClick={() => {
                          setRemoveError(null);
                          setRemoveTarget(entry);
                        }}
                      >
                        Entfernen
                      </Button>
                    )}
                  </div>
                  <p className="break-all font-mono text-xs text-dim">{runtime.path}</p>
                  {runtime.origin === null ? null : <p className="hint">{runtime.origin}</p>}
                  {users.length > 0 ? <p className="hint">Wird gerade verwendet von: {users.join(', ')}.</p> : null}
                </li>
              );
            })}
          </ul>
        )}

        {[...running].map((major) => (
          <JavaProgress key={major} major={major} fallback={system.javaInstalls.find((entry) => entry.major === major) ?? { percent: null, message: null }} />
        ))}

        {offers.length === 0 ? null : (
          <div className="space-y-2">
            <p className="label">Von Hand installieren</p>
            <div className="flex flex-wrap gap-2">
              {offers.map((major) => (
                <Button
                  key={major}
                  size="sm"
                  variant={major === needed ? 'primary' : 'secondary'}
                  icon={Download}
                  loading={installing === major}
                  disabled={installing !== null || running.has(major)}
                  onClick={() => void install(major)}
                >
                  Java {major} installieren
                </Button>
              ))}
            </div>
            <p className="hint">
              {needed === null ? '' : `Dieser Server braucht Java ${needed}${server.loader === 'forge' && needed <= 8 ? ' (genau diese Version)' : ' oder neuer'}. `}
              Die Laufzeit kommt von adoptium.net, wird per SHA-256 geprüft und nur im Datenordner von CraftManager abgelegt; Windows, PATH und Registry bleiben unverändert.
            </p>
          </div>
        )}

        {error === null ? null : <ErrorNotice error={error} title="Die Java-Installation ist fehlgeschlagen" />}
        {notice === null ? null : <Notice tone="success">{notice}</Notice>}
      </div>

      <Dialog
        open={removeTarget !== null}
        title={`Java ${removeTarget?.major ?? ''} entfernen?`}
        onClose={() => setRemoveTarget(null)}
        footer={
          <>
            <Button onClick={() => setRemoveTarget(null)}>Abbrechen</Button>
            <Button variant="danger-solid" icon={Trash2} loading={removing} onClick={() => void remove()}>
              Entfernen
            </Button>
          </>
        }
      >
        <p>
          Die von CraftManager installierte Java-Laufzeit (installiert am {removeTarget === null ? '' : formatDateTime(removeTarget.installedAt)}) wird gelöscht. Bei Bedarf wird sie beim nächsten Start erneut heruntergeladen.
        </p>
        {removeError === null ? null : <ErrorNotice error={removeError} />}
      </Dialog>
    </Section>
  );
}

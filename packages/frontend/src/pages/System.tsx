import { ExternalLink, RefreshCw } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { NetworkSection } from '../components/NetworkSettings';
import { PasswordSection } from '../components/PasswordSettings';
import { ApplyUpdate, UpdateProgress, useUpdateActions } from '../components/UpdateControls';
import { Button, ErrorNotice, LoadingBlock, Notice, Section, Toggle } from '../components/ui';
import { formatBytes, formatDateTime } from '../lib/format';
import { safeHref, SafeMarkdown } from '../lib/markdown';
import { RESULT_LABEL, isRunning } from '../lib/update';
import type { SystemUpdateState } from '../lib/types';
import { useLive } from '../live/LiveProvider';

const MODE_LABEL = { service: 'Dienst (Update-Dienst vorhanden)', portable: 'Portabel oder ohne Update-Dienst', dev: 'Quellcode (Entwicklung)' } as const;

function History({ state }: { state: SystemUpdateState }): ReactNode {
  if (state.history.length === 0) return <p className="hint">Es wurde noch kein Update durchgeführt.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-dim">
          <tr>
            <th className="py-1 pr-4 font-medium">Zeitpunkt</th>
            <th className="py-1 pr-4 font-medium">Von → Auf</th>
            <th className="py-1 pr-4 font-medium">Ergebnis</th>
            <th className="py-1 font-medium">Hinweis</th>
          </tr>
        </thead>
        <tbody>
          {state.history.map((entry) => (
            <tr key={entry.id} className="border-t border-line align-top">
              <td className="num py-1.5 pr-4 whitespace-nowrap">{formatDateTime(entry.finishedAt)}</td>
              <td className="num py-1.5 pr-4 whitespace-nowrap">
                {entry.fromVersion} → {entry.toVersion}
              </td>
              <td className={`py-1.5 pr-4 whitespace-nowrap ${entry.result === 'success' ? 'text-ok' : entry.result === 'cancelled' ? 'text-dim' : 'text-bad'}`}>{RESULT_LABEL[entry.result]}</td>
              <td className="py-1.5 text-dim">{entry.message ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SystemPage(): ReactNode {
  const { state } = useLive();
  const actions = useUpdateActions();
  const update = state.update;

  useEffect(() => {
    document.title = 'System · CraftManager';
  }, []);

  // network and password do not depend on the update state; the update sections follow as soon as it is known
  if (update === null) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl">System</h1>
        <NetworkSection />
        <PasswordSection />
        <LoadingBlock label="Update-Status wird geladen …" />
      </div>
    );
  }
  const latest = update.latest;
  const releaseLink = latest === null ? null : safeHref(latest.htmlUrl);

  return (
    <div className="space-y-5">
      <h1 className="text-xl">System</h1>

      {update.phase === 'failed' ? (
        <Notice tone="error" title="Das Update ist fehlgeschlagen" action={<Button size="sm" onClick={() => void actions.dismiss()}>Verstanden</Button>}>
          <p>{update.error ?? 'Unbekannter Grund.'}</p>
        </Notice>
      ) : null}
      {update.phase === 'done' ? (
        <Notice tone="success" title={`CraftManager läuft jetzt in Version ${update.currentVersion}`} action={<Button size="sm" onClick={() => void actions.dismiss()}>Schließen</Button>}>
          <p>Die vorher laufenden Server wurden wieder gestartet.</p>
        </Notice>
      ) : null}

      <Section title="Version" description="Installierte Version und Art der Installation">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-dim">Installiert</dt>
            <dd className="num text-lg font-semibold">{update.currentVersion}</dd>
          </div>
          <div>
            <dt className="text-dim">Installationsart</dt>
            <dd>{MODE_LABEL[update.installMode]}</dd>
          </div>
          <div>
            <dt className="text-dim">Quelle</dt>
            <dd className="font-mono">{update.repo}</dd>
          </div>
          <div>
            <dt className="text-dim">Kanal</dt>
            <dd>{update.channel === 'stable' ? 'Stabile Versionen' : 'Auch Vorabversionen'}</dd>
          </div>
        </dl>
        {update.installModeNote === null ? null : (
          <Notice tone="info" className="mt-4">
            <p>{update.installModeNote}</p>
          </Notice>
        )}
      </Section>

      <NetworkSection />

      <PasswordSection />

      <Section
        title="Updates"
        description={update.lastCheckAt === null ? 'Noch nicht geprüft.' : `Zuletzt geprüft: ${formatDateTime(update.lastCheckAt)}`}
        action={
          <Button icon={RefreshCw} loading={update.checking || actions.busy} disabled={!update.checksEnabled || isRunning(update)} onClick={() => void actions.check()}>
            Jetzt prüfen
          </Button>
        }
      >
        <div className="space-y-4">
          {!update.checksEnabled ? (
            <Notice tone="warn">
              <p>Update-Prüfungen sind in der Konfiguration abgeschaltet (UPDATE_CHECK=false).</p>
            </Notice>
          ) : (
            <Toggle
              checked={update.autoCheck}
              onChange={(value) => void actions.setAutoCheck(value)}
              disabled={actions.busy}
              label="Automatisch nach Updates suchen"
              description="Etwa alle 6 Stunden. Gefundene Updates werden nur angezeigt, nie ohne Bestätigung installiert."
            />
          )}
          {actions.error === null ? null : <ErrorNotice error={new Error(actions.error)} />}
          {update.lastCheckError === null ? null : (
            <Notice tone="warn" title="Die letzte Prüfung ist fehlgeschlagen">
              <p>{update.lastCheckError}</p>
            </Notice>
          )}

          {isRunning(update) ? (
            <div className="rounded-lg border border-line p-3">
              <UpdateProgress state={update} actions={actions} />
            </div>
          ) : latest === null ? (
            <p className="text-dim">{update.lastCheckAt === null ? 'Mit „Jetzt prüfen“ nach der neuesten Version suchen.' : 'Es wurde kein Release gefunden.'}</p>
          ) : (
            <div className="space-y-3">
              <p>
                {update.updateAvailable ? (
                  <>
                    Neu: <strong>Version {latest.version}</strong>
                    {latest.prerelease ? ' (Vorabversion)' : ''}
                    {latest.publishedAt === null ? '' : `, veröffentlicht ${formatDateTime(latest.publishedAt)}`}
                    {latest.assetSizeBytes === null ? '' : `, ${formatBytes(latest.assetSizeBytes)}`}
                  </>
                ) : (
                  <>CraftManager ist auf dem neuesten Stand (neueste Version: {latest.version}).</>
                )}
              </p>
              {update.updateAvailable ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    {update.canApply ? <ApplyUpdate state={update} actions={actions} /> : null}
                    {releaseLink === null ? null : (
                      <a className="btn" href={releaseLink} target="_blank" rel="noopener noreferrer">
                        <ExternalLink aria-hidden className="size-4" />
                        Release auf GitHub
                      </a>
                    )}
                  </div>
                  {update.canApply || update.canApplyReason === null ? null : <p className="hint">{update.canApplyReason}</p>}
                  <div className="rounded-lg border border-line p-3">
                    <h3 className="mb-2 text-sm font-semibold">Versionshinweise</h3>
                    <SafeMarkdown source={latest.notes} />
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </Section>

      <Section title="Verlauf" description="Bisherige Updates von CraftManager">
        <History state={update} />
      </Section>
    </div>
  );
}

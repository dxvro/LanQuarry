import { KeyRound } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { authApi } from '../lib/endpoints';
import { PASSWORD_MIN_LENGTH, passwordStrength } from '../lib/password';
import { Button, ErrorNotice, Field, Notice, Section, cx } from './ui';

function StrengthMeter({ password }: { password: string }): ReactNode {
  if (password === '') return null;
  const { level, label, hint } = passwordStrength(password);
  const color = level === 3 ? 'bg-ok' : level === 2 ? 'bg-warn' : 'bg-bad';
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((segment) => (
          <span key={segment} className={cx('h-1.5 flex-1 rounded-full', segment <= level ? color : 'bg-raised')} />
        ))}
      </div>
      <p className="hint">
        <strong className="font-medium text-ink">{label}.</strong> {hint}
      </p>
    </div>
  );
}

export function PasswordSection(): ReactNode {
  const { authRequired, credential, checkSession } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const mismatch = repeat !== '' && repeat !== next;
  const tooShort = next !== '' && next.length < PASSWORD_MIN_LENGTH;
  const canSubmit = next.length >= PASSWORD_MIN_LENGTH && repeat === next && (!authRequired || current !== '');

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await authApi.changePassword(authRequired ? { currentPassword: current, newPassword: next } : { newPassword: next });
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
      await checkSession();
    } catch (cause) {
      setError(cause);
      setCurrent('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Passwort" description={authRequired ? 'Passwort der Weboberfläche ändern' : 'Die Weboberfläche vor fremdem Zugriff schützen'}>
      <div className="space-y-4">
        {!authRequired ? (
          <Notice tone="warn" title="Es ist kein Passwort gesetzt">
            <p>Jeder, der diesen Rechner im Netzwerk erreicht, kann Server starten, Konsolenbefehle ausführen und Einstellungen ändern. Bitte ein Passwort festlegen.</p>
          </Notice>
        ) : (
          <p className="text-dim">
            {credential === 'password'
              ? 'Die Anmeldung erfolgt mit dem Passwort, das hier festgelegt wurde.'
              : 'Zurzeit gilt das Zugriffstoken (AUTH_TOKEN) aus der Konfiguration als Passwort. Ein eigenes Passwort ersetzt es für die Anmeldung im Browser.'}{' '}
            Nach der Änderung werden alle anderen Anmeldungen beendet; diese bleibt bestehen.
          </p>
        )}
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          {authRequired ? (
            <Field label="Aktuelles Passwort" hint={credential === 'password' ? undefined : 'Solange noch kein eigenes Passwort gesetzt ist, ist das das Zugriffstoken.'}>
              {(props) => <input {...props} className="input" type="password" name="current-password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />}
            </Field>
          ) : null}
          <Field label="Neues Passwort" error={tooShort ? `Mindestens ${PASSWORD_MIN_LENGTH} Zeichen.` : undefined}>
            {(props) => <input {...props} className="input" type="password" name="new-password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />}
          </Field>
          <StrengthMeter password={next} />
          <Field label="Neues Passwort wiederholen" error={mismatch ? 'Die beiden Eingaben stimmen nicht überein.' : undefined}>
            {(props) => <input {...props} className="input" type="password" name="repeat-password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} />}
          </Field>
          {error === null ? null : <ErrorNotice error={error} />}
          {done ? (
            <Notice tone="success" title={authRequired ? 'Das Passwort wurde geändert' : 'Das Passwort wurde festgelegt'}>
              <p>Alle anderen Anmeldungen sind beendet. Diese Sitzung bleibt angemeldet.</p>
            </Notice>
          ) : null}
          <Button type="submit" variant="primary" icon={KeyRound} loading={busy} disabled={!canSubmit}>
            {authRequired ? 'Passwort ändern' : 'Passwort festlegen'}
          </Button>
        </form>
        <p className="hint">
          Das Zugriffstoken (AUTH_TOKEN) in der Konfigurationsdatei bleibt unverändert und gilt weiter für Skripte und die API (<code>Authorization: Bearer …</code>), auch für den Update-Dienst. Passwort vergessen: auf dem Server-Rechner
          „craftmanager reset-password“ (Linux) bzw. „Passwort zurücksetzen“ im Startmenü (Windows).
        </p>
      </div>
    </Section>
  );
}

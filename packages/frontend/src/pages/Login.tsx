import { KeyRound } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Disclaimer } from '../components/Disclaimer';
import { ErrorNotice, Button, Field } from '../components/ui';
import { ApiError } from '../lib/api';

export function Login(): ReactNode {
  const { login, credential } = useAuth();
  const usesPassword = credential === 'password';
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [retryIn, setRetryIn] = useState(0);

  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = setTimeout(() => setRetryIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [retryIn]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (token === '' || busy || retryIn > 0) return;
    setBusy(true);
    setError(null);
    try {
      await login(token);
    } catch (cause) {
      setError(cause);
      setToken('');
      if (cause instanceof ApiError && cause.code === 'TOO_MANY_ATTEMPTS') {
        const details = cause.details as { retryAfterSeconds?: unknown } | undefined;
        if (typeof details?.retryAfterSeconds === 'number') setRetryIn(details.retryAfterSeconds);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 py-8">
      <form onSubmit={(event) => void submit(event)} className="panel w-full max-w-sm space-y-5 p-6">
        <div className="space-y-2">
          <span className="grid size-10 place-items-center rounded-lg bg-raised text-accent">
            <KeyRound aria-hidden className="size-5" />
          </span>
          <h1 className="text-xl">Anmeldung erforderlich</h1>
          {usesPassword ? (
            <p className="text-dim">Dieser CraftManager ist mit einem Passwort geschützt. Passwort vergessen? Auf dem Server-Rechner lässt es sich mit dem Befehl „craftmanager reset-password“ (Linux) bzw. über „Passwort zurücksetzen“ im Startmenü (Windows) neu setzen.</p>
          ) : (
            <p className="text-dim">Dieser CraftManager ist mit einem Zugriffstoken geschützt. Das Token steht in der Konfiguration (AUTH_TOKEN) auf dem Server-Rechner. Es dient als erstes Passwort und lässt sich nach der Anmeldung unter System ändern.</p>
          )}
        </div>
        <Field label={usesPassword ? 'Passwort' : 'Zugriffstoken'}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="password"
              name="token"
              autoComplete="current-password"
              autoFocus
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          )}
        </Field>
        {error === null ? null : <ErrorNotice error={error} />}
        {retryIn > 0 ? <p className="hint">Neuer Versuch möglich in {retryIn} s.</p> : null}
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={token === '' || retryIn > 0}>
          Anmelden
        </Button>
      </form>
      <Disclaimer className="max-w-sm text-center" />
    </div>
  );
}

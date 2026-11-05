import { useEffect, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { Button, EmptyState, ErrorNotice, LoadingBlock } from './components/ui';
import { LiveProvider } from './live/LiveProvider';
import { RouterProvider, useRouter } from './lib/router';
import { CreateWizard } from './pages/CreateWizard';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { ServerPage } from './pages/ServerPage';
import { SearchX } from 'lucide-react';

function Routes(): ReactNode {
  const { route, visit, navigate } = useRouter();
  switch (route.name) {
    case 'overview':
      return <Overview />;
    case 'new':
      return <CreateWizard key={visit} />;
    case 'server':
      return <ServerPage id={route.id} tab={route.tab} />;
    case 'not-found':
      return (
        <EmptyState icon={SearchX} title="Seite nicht gefunden" action={<Button onClick={() => navigate('/')}>Zur Übersicht</Button>}>
          <p>Diese Adresse gehört zu keiner Seite des CraftManagers.</p>
        </EmptyState>
      );
  }
}

function Gate(): ReactNode {
  const { phase, error, checkSession } = useAuth();

  useEffect(() => {
    if (phase === 'login') document.title = 'Anmeldung · CraftManager';
  }, [phase]);

  if (phase === 'loading') return <LoadingBlock label="CraftManager wird gestartet …" className="justify-center" />;
  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorNotice error={new Error(error ?? 'Unbekannter Fehler.')} title="Keine Verbindung zum CraftManager" action={<Button size="sm" onClick={() => void checkSession()}>Erneut versuchen</Button>} />
      </div>
    );
  }
  if (phase === 'login') return <Login />;
  return (
    <LiveProvider>
      <AppShell>
        <Routes />
      </AppShell>
    </LiveProvider>
  );
}

export function App(): ReactNode {
  return (
    <AuthProvider>
      <RouterProvider>
        <Gate />
      </RouterProvider>
    </AuthProvider>
  );
}

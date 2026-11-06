export const login = {
  documentTitle: 'Anmeldung · CraftManager',
  title: 'Anmeldung erforderlich',
  passwordIntro:
    'Dieser CraftManager ist mit einem Passwort geschützt. Passwort vergessen? Auf dem Server-Rechner lässt es sich mit dem Befehl „craftmanager reset-password“ (Linux) bzw. über „Passwort zurücksetzen“ im Startmenü (Windows) neu setzen.',
  tokenIntro:
    'Dieser CraftManager ist mit einem Zugriffstoken geschützt. Das Token steht in der Konfiguration (AUTH_TOKEN) auf dem Server-Rechner. Es dient als erstes Passwort und lässt sich nach der Anmeldung unter System ändern.',
  passwordLabel: 'Passwort',
  tokenLabel: 'Zugriffstoken',
  retryIn: (seconds: number) => `Neuer Versuch möglich in ${seconds} s.`,
  submit: 'Anmelden',
};

// Password section of the system page (components/PasswordSettings.tsx) and the strength hints (lib/password.ts).
export const password = {
  title: 'Passwort',
  describeChange: 'Passwort der Weboberfläche ändern',
  describeSet: 'Die Weboberfläche vor fremdem Zugriff schützen',
  noPasswordTitle: 'Es ist kein Passwort gesetzt',
  noPasswordText:
    'Jeder, der diesen Rechner im Netzwerk erreicht, kann Server starten, Konsolenbefehle ausführen und Einstellungen ändern. Bitte ein Passwort festlegen.',
  signedInWithPassword: 'Die Anmeldung erfolgt mit dem Passwort, das hier festgelegt wurde.',
  signedInWithToken:
    'Zurzeit gilt das Zugriffstoken (AUTH_TOKEN) aus der Konfiguration als Passwort. Ein eigenes Passwort ersetzt es für die Anmeldung im Browser.',
  otherSessionsEnd: 'Nach der Änderung werden alle anderen Anmeldungen beendet; diese bleibt bestehen.',
  current: 'Aktuelles Passwort',
  currentHint: 'Solange noch kein eigenes Passwort gesetzt ist, ist das das Zugriffstoken.',
  next: 'Neues Passwort',
  repeat: 'Neues Passwort wiederholen',
  minLength: (min: number) => `Mindestens ${min} Zeichen.`,
  mismatch: 'Die beiden Eingaben stimmen nicht überein.',
  changedTitle: 'Das Passwort wurde geändert',
  setTitle: 'Das Passwort wurde festgelegt',
  doneText: 'Alle anderen Anmeldungen sind beendet. Diese Sitzung bleibt angemeldet.',
  change: 'Passwort ändern',
  set: 'Passwort festlegen',
  tokenNoteStart: 'Das Zugriffstoken (AUTH_TOKEN) in der Konfigurationsdatei bleibt unverändert und gilt weiter für Skripte und die API (',
  tokenNoteEnd:
    '), auch für den Update-Dienst. Passwort vergessen: auf dem Server-Rechner „craftmanager reset-password“ (Linux) bzw. „Passwort zurücksetzen“ im Startmenü (Windows).',
  strength: {
    tooShort: 'Zu kurz',
    tooShortHint: (min: number, missing: number) => `Mindestens ${min} Zeichen (noch ${missing}).`,
    weak: 'Schwach',
    weakHint: 'Besser: mehrere Wörter, Ziffern oder Sonderzeichen mischen und länger wählen.',
    fair: 'Mittel',
    fairHint: 'Mit 14 oder mehr Zeichen und gemischten Zeichen wird es stark.',
    strong: 'Stark',
    strongHint: 'Gute Wahl.',
  },
};

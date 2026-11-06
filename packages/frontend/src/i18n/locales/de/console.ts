export const console = {
  stream: { stdout: 'Ausgabe', stderr: 'Fehler', input: 'Eingabe', system: 'System' },
  crash: {
    label: 'Absturzdetails',
    notStarted: 'Der Server konnte nicht gestartet werden',
    crashed: 'Der Server ist abgestürzt',
    noExitCode: 'Kein Exit-Code verfügbar.',
    exitCode: (code: number) => `Exit-Code ${code}.`,
    lastLines: 'Letzte Zeilen',
    lastLinesLabel: 'Letzte Zeilen vor dem Absturz',
  },
  connection: {
    connecting: 'Konsole verbindet …',
    reconnecting: 'Konsole getrennt, es wird neu verbunden …',
  },
  filter: {
    label: 'Konsole filtern',
    placeholder: 'Filter (Text)',
    streamsLabel: 'Ausgabekanäle',
    lines: (count: number) => `${count} Zeilen`,
    linesOf: (shown: number, total: number) => `${shown} von ${total} Zeilen`,
    max: ' (Maximum)',
  },
  log: {
    label: (name: string) => `Konsole von ${name}`,
    empty: 'Noch keine Ausgabe. Sobald der Server startet, erscheinen die Zeilen hier.',
    waiting: 'Warte auf die Verbindung …',
    noMatch: 'Keine Zeile passt zum Filter.',
    newLines: (count: number) => `${count} neue Zeilen`,
    jumpToNewest: 'Zu den neuesten Zeilen',
  },
  command: {
    label: 'Befehl an den Server',
    placeholderOnline: 'Befehl eingeben, z. B. say Hallo',
    placeholderOffline: 'Der Server läuft nicht',
    send: 'Senden',
    sendFailed: 'Der Befehl konnte nicht gesendet werden.',
    historyHint: 'Mit den Pfeiltasten (hoch/runter) lassen sich frühere Befehle abrufen.',
  },
  // progress message while the install has just been requested (live/reducer.ts)
  live: { installStarting: 'Installation startet' },
  // text of the marker row where lines were lost (see console/model.ts)
  gap: {
    one: 'Eine Zeile fehlt (Puffer überschritten).',
    many: (missing: number) => `${missing} Zeilen fehlen (Puffer überschritten).`,
  },
  // CommandError messages (console/session.ts, console/useConsole.ts)
  errors: {
    timeout: 'Der Server hat den Befehl nicht bestätigt.',
    notConnectedSent: 'Keine Verbindung zur Konsole. Der Befehl wurde nicht gesendet.',
    interrupted: 'Die Verbindung zur Konsole wurde unterbrochen.',
    closed: 'Die Konsole wurde geschlossen.',
    notConnected: 'Keine Verbindung zur Konsole.',
  },
};

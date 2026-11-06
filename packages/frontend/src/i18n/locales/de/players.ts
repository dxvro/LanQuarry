export const players = {
  loading: 'Spielerlisten werden geladen …',
  loadFailed: 'Die Spielerlisten konnten nicht geladen werden',
  actionFailed: 'Die Änderung wurde nicht übernommen',
  refresh: 'Aktualisieren',
  unsupportedTitle: 'Spielerlisten nicht verfügbar',
  unsupported: (mcVersion: string) =>
    `Minecraft ${mcVersion} führt Whitelist, Operatoren und Sperren noch nicht als JSON-Dateien (erst ab Version 1.7.6). Diese Listen lassen sich für diese Version hier nicht verwalten.`,
  busy: 'Der Server startet oder stoppt gerade. Die Listen sind lesbar, Änderungen sind erst möglich, wenn er läuft oder gestoppt ist.',
  pending:
    'Der Befehl wurde an den Server geschickt, er hat die Änderung aber noch nicht in die Datei geschrieben. Sie erscheint gleich automatisch oder nach einem Klick auf „Aktualisieren“.',
  corrupt: (file: string) =>
    `Die Datei ${file} ist beschädigt und wird deshalb als leer angezeigt. Sie wird nicht überschrieben. Bitte die Datei reparieren oder löschen, dann lässt sich die Liste hier wieder bearbeiten.`,
  files: { whitelist: 'whitelist.json', ops: 'ops.json', bannedPlayers: 'banned-players.json', bannedIps: 'banned-ips.json' },

  status: {
    title: 'Status',
    modeLabel: 'Bearbeitung',
    modeLive: 'Live über die Konsole',
    modeFile: 'Direkt in den Dateien',
    modeLiveHelp: 'Der Server läuft: Änderungen werden sofort über die Konsole angewendet.',
    modeFileHelp: 'Der Server ist gestoppt: Die Dateien werden direkt bearbeitet, die Änderungen gelten beim nächsten Start.',
    whitelistToggle: 'Whitelist erzwingen',
    whitelistOn: 'Nur eingetragene Spieler dürfen beitreten.',
    whitelistOff: 'Die Whitelist ist ausgeschaltet: Jeder darf beitreten. Die Einträge unten werden dann nicht beachtet.',
    whitelistRestart: 'Der Server läuft: Die Umschaltung wird sofort über die Konsole angewendet.',
    whitelistWorld: 'Dieselbe Einstellung (white-list) steht auch im Reiter „Welt-Einstellungen“.',
    whitelistFailed: 'Die Whitelist-Einstellung wurde nicht gespeichert',
    offlineMode:
      'Der Online-Modus ist ausgeschaltet: Namen werden nicht bei Mojang geprüft, jeder kann sich unter fremdem Namen anmelden. Whitelist und Operatoren schützen dann kaum.',
    opLevelDefault: (level: number) => `Standard-Level für /op: ${level}`,
  },

  online: {
    title: 'Online-Spieler',
    count: (n: number) => (n === 1 ? '1 Spieler online' : `${n} Spieler online`),
    offlineHint: 'Der Server ist nicht online. Spieler lassen sich hier nur hinzufügen, solange sie spielen.',
    none: 'Zurzeit ist niemand online.',
    whitelist: 'Whitelist',
    whitelisted: 'Steht auf der Whitelist',
    op: 'Op',
    isOp: 'Ist Operator',
    ban: 'Sperren …',
    addWhitelistLabel: (name: string) => `${name} auf die Whitelist setzen`,
    opLabel: (name: string) => `${name} zum Operator machen`,
    banLabel: (name: string) => `${name} sperren`,
  },

  name: {
    label: 'Spielername',
    placeholder: 'z. B. Steve',
    invalid: 'Ungültiger Name: 1 bis 16 Zeichen, nur Buchstaben, Ziffern und Unterstrich.',
    invalidOffline: 'Ungültiger Name: 1 bis 32 sichtbare Zeichen ohne Leerzeichen, darf nicht mit @ beginnen.',
    required: 'Bitte einen Spielernamen eingeben.',
    lookupHint: 'Der Name wird bei Mojang nachgeschlagen, um die UUID zu finden.',
  },
  reason: {
    label: 'Grund (optional)',
    none: 'Kein Grund angegeben',
  },

  whitelist: {
    title: 'Whitelist',
    description: 'Wer hier steht, darf beitreten, solange die Whitelist erzwungen wird.',
    add: 'Hinzufügen',
    empty: 'Die Whitelist ist leer.',
    remove: 'Entfernen',
    removeLabel: (name: string) => `${name} von der Whitelist entfernen`,
    count: (n: number) => (n === 1 ? '1 Eintrag' : `${n} Einträge`),
  },

  ops: {
    title: 'Operatoren',
    description: 'Operatoren dürfen Befehle ausführen. Der Level legt fest, welche.',
    add: 'Zum Operator machen',
    empty: 'Es gibt keine Operatoren.',
    levelLabel: 'Level',
    levelOption: (level: number, short: string) => `Level ${level}: ${short}`,
    levelServerDefault: (level: number) => `Level ${level}: Standard des Servers`,
    bypass: 'Spielerlimit umgehen',
    bypassHelp: 'Der Operator kann auch beitreten, wenn der Server voll ist.',
    liveLocked: (level: number) =>
      `Solange der Server läuft, vergibt „/op“ immer den Standard-Level (${level}) und kein Spielerlimit-Bypass. Andere Werte lassen sich nur bei gestopptem Server setzen.`,
    fileOverwrite: 'Steht der Spieler schon in der Liste, werden Level und Spielerlimit-Bypass überschrieben.',
    levels: {
      1: { short: 'Spawnschutz', help: 'Darf den Spawnschutz umgehen und Blöcke im Spawn-Bereich ändern.' },
      2: { short: 'Spielbefehle', help: 'Darf die meisten Spielbefehle nutzen, z. B. /give, /gamemode, /tp und Befehlsblöcke.' },
      3: { short: 'Spielerverwaltung', help: 'Darf zusätzlich Spieler verwalten, z. B. /kick, /ban und /op.' },
      4: { short: 'Voller Zugriff', help: 'Darf alles, auch den Server beenden (/stop) und speichern (/save-all).' },
    },
    levelChip: (level: number) => `Level ${level}`,
    bypassChip: 'Limit umgehen',
    remove: 'Op entziehen',
    removeLabel: (name: string) => `${name} die Operatorrechte entziehen`,
  },

  bans: {
    title: 'Gesperrte Spieler',
    description: 'Gesperrte Spieler können nicht beitreten.',
    add: 'Sperren',
    empty: 'Es sind keine Spieler gesperrt.',
    unban: 'Entsperren',
    unbanLabel: (name: string) => `${name} entsperren`,
    created: 'Gesperrt am',
    source: 'Von',
    expires: 'Bis',
    forever: 'unbefristet',
  },

  banDialog: {
    title: (name: string) => `${name} sperren?`,
    body: 'Der Spieler wird gesperrt und, falls er online ist, sofort vom Server geworfen.',
    confirm: 'Sperren',
  },

  ips: {
    title: 'Gesperrte IP-Adressen',
    description: 'Verbindungen von diesen Adressen werden abgelehnt.',
    label: 'IP-Adresse',
    placeholder: 'z. B. 203.0.113.7',
    invalid: 'Ungültige IP-Adresse (IPv4 oder IPv6).',
    required: 'Bitte eine IP-Adresse eingeben.',
    add: 'Sperren',
    empty: 'Es sind keine IP-Adressen gesperrt.',
    unban: 'Entsperren',
    unbanLabel: (ip: string) => `${ip} entsperren`,
  },
};

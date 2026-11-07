import type { KnownPropertyKey } from '../../../lib/propertyKeys';

interface PropertyText {
  label: string;
  help: string;
}

// Label and one-line description for every key of the property catalog; the `satisfies` makes a missing key a compile error.
const props = {
  // world
  'level-name': { label: 'Weltname', help: 'Name des Weltordners. Ein neuer Name legt beim nächsten Start eine neue Welt an.' },
  'level-seed': { label: 'Seed', help: 'Startwert der Weltgenerierung. Leer lässt ihn zufällig wählen. Wirkt nur bei neuen Welten.' },
  'level-type': { label: 'Welttyp', help: 'Art der Generierung, z. B. normal oder flach. Wirkt nur bei neuen Welten.' },
  'generator-settings': { label: 'Generator-Einstellungen', help: 'Feineinstellungen für flache oder angepasste Welten, meist als JSON. Wirkt nur bei neuen Welten.' },
  'generate-structures': { label: 'Strukturen erzeugen', help: 'Dörfer, Festungen, Tempel und ähnliche Bauwerke in neuen Chunks erzeugen.' },
  'max-world-size': { label: 'Maximale Weltgröße', help: 'Radius der Welt in Blöcken, jenseits davon endet die Weltgrenze.' },
  'spawn-protection': { label: 'Spawnschutz (Radius)', help: 'Radius in Blöcken um den Spawn, den nur Operatoren verändern dürfen. 0 schaltet ihn ab.' },
  'allow-nether': { label: 'Nether erlauben', help: 'Wenn aus, funktionieren Netherportale nicht.' },
  'spawn-monsters': { label: 'Monster erscheinen', help: 'Feindliche Monster dürfen natürlich spawnen.' },
  'spawn-animals': { label: 'Tiere erscheinen', help: 'Tiere dürfen natürlich spawnen.' },
  'spawn-npcs': { label: 'Dorfbewohner erscheinen', help: 'Dorfbewohner dürfen in Dörfern spawnen.' },
  'view-distance': { label: 'Sichtweite (Chunks)', help: 'Wie viele Chunks um jeden Spieler an den Client gesendet werden. Höher belastet den Server stärker.' },
  'simulation-distance': { label: 'Simulationsreichweite (Chunks)', help: 'Bis zu welcher Entfernung Tiere, Pflanzen und Maschinen um Spieler berechnet werden.' },
  // gameplay
  gamemode: { label: 'Spielmodus', help: 'Standard-Spielmodus für neue Spieler.' },
  difficulty: { label: 'Schwierigkeit', help: 'Schwierigkeitsgrad der Welt.' },
  hardcore: { label: 'Hardcore', help: 'Die Schwierigkeit ist auf „Schwer“ festgelegt, gestorbene Spieler werden zu Zuschauern.' },
  pvp: { label: 'PvP', help: 'Spieler dürfen sich gegenseitig Schaden zufügen.' },
  'allow-flight': { label: 'Fliegen erlauben', help: 'Verhindert, dass Spieler mit Mods oder Plugins zum Fliegen gekickt werden.' },
  'force-gamemode': { label: 'Spielmodus erzwingen', help: 'Setzt Spieler beim Beitritt auf den Standard-Spielmodus zurück.' },
  'enable-command-block': { label: 'Befehlsblöcke', help: 'Befehlsblöcke dürfen Befehle ausführen.' },
  // players
  'max-players': { label: 'Maximale Spielerzahl', help: 'Wie viele Spieler gleichzeitig online sein dürfen.' },
  'white-list': { label: 'Whitelist', help: 'Nur Spieler auf der Whitelist dürfen beitreten.' },
  'enforce-whitelist': { label: 'Whitelist sofort durchsetzen', help: 'Wirft Spieler, die nicht auf der Whitelist stehen, beim Neuladen der Liste hinaus.' },
  'online-mode': { label: 'Online-Modus', help: 'Prüft Konten bei Mojang. Ausschalten erlaubt jedem, sich unter fremdem Namen anzumelden.' },
  'hide-online-players': { label: 'Spielerliste verbergen', help: 'Die Serverliste zeigt nicht, wer online ist.' },
  'op-permission-level': { label: 'Standard-Level für Operatoren', help: 'Level, den „/op“ vergibt (0 bis 4).' },
  'player-idle-timeout': { label: 'Leerlauf-Zeitlimit (Minuten)', help: 'Untätige Spieler werden nach dieser Zeit gekickt. 0 schaltet es ab.' },
  'enforce-secure-profile': { label: 'Signierte Chatnachrichten verlangen', help: 'Nur Spieler mit signiertem Mojang-Profil dürfen beitreten.' },
  'require-resource-pack': { label: 'Ressourcenpaket erzwingen', help: 'Spieler, die das Ressourcenpaket ablehnen, werden getrennt.' },
  'resource-pack': { label: 'Ressourcenpaket (URL)', help: 'Adresse des Ressourcenpakets, das Spieler beim Beitritt angeboten bekommen.' },
  'resource-pack-sha1': { label: 'Ressourcenpaket (SHA-1)', help: 'Prüfsumme des Ressourcenpakets, damit es im Cache der Spieler erkannt wird.' },
  'resource-pack-prompt': { label: 'Ressourcenpaket (Hinweistext)', help: 'Nachricht, die Spielern beim Angebot des Ressourcenpakets angezeigt wird.' },
  // network
  motd: { label: 'MOTD', help: 'Nachricht in der Serverliste der Spieler.' },
  'server-port': { label: 'Port', help: 'Port, auf dem der Server Verbindungen annimmt (Standard 25565).' },
  'server-ip': { label: 'Server-IP', help: 'An diese Adresse bindet der Server. Leer lässt ihn auf allen Adressen lauschen.' },
  'enable-status': { label: 'Serverstatus anzeigen', help: 'Der Server antwortet auf Statusanfragen der Serverliste. Ausgeschaltet erscheint er dort als offline.' },
  'enable-query': { label: 'Query-Protokoll', help: 'Aktiviert das GameSpy4-Query-Protokoll für Statusabfragen.' },
  'query.port': { label: 'Query-Port', help: 'UDP-Port des Query-Protokolls.' },
  'enable-rcon': { label: 'RCON', help: 'Fernsteuerung des Servers über das RCON-Protokoll. Nur mit starkem Passwort einschalten.' },
  'rcon.port': { label: 'RCON-Port', help: 'Port, auf dem RCON lauscht.' },
  'rcon.password': { label: 'RCON-Passwort', help: 'Passwort für RCON-Verbindungen. Ohne Passwort startet RCON nicht.' },
  'prevent-proxy-connections': { label: 'Proxy-Verbindungen blockieren', help: 'Trennt Spieler, deren Verbindung über einen Proxy oder VPN zu laufen scheint.' },
  'rate-limit': { label: 'Paketlimit je Spieler', help: 'Höchstzahl von Paketen pro Sekunde, danach wird der Spieler getrennt. 0 schaltet es ab.' },
  'network-compression-threshold': { label: 'Kompressionsschwelle (Bytes)', help: 'Ab dieser Paketgröße wird komprimiert. -1 schaltet die Kompression ab.' },
  'accepts-transfers': { label: 'Transfers annehmen', help: 'Erlaubt Spielern, von anderen Servern mit Transfer-Paket herüberzuwechseln.' },
  // advanced
  'broadcast-console-to-ops': { label: 'Konsole an Operatoren senden', help: 'Konsolenausgaben von Befehlen an Operatoren im Spiel zeigen.' },
  'broadcast-rcon-to-ops': { label: 'RCON an Operatoren senden', help: 'RCON-Befehlsausgaben an Operatoren im Spiel zeigen.' },
  'bug-report-link': { label: 'Fehlerbericht-Link', help: 'Adresse, die Spielern im Absturzbildschirm als Meldeweg angezeigt wird.' },
  'entity-broadcast-range-percentage': { label: 'Sichtbarkeit von Entitäten (%)', help: 'Skaliert, aus welcher Entfernung Entitäten gesendet werden. Niedriger spart Leistung.' },
  'function-permission-level': { label: 'Level für Funktionen', help: 'Berechtigungsstufe, mit der Datapack-Funktionen laufen (1 bis 4).' },
  'log-ips': { label: 'IP-Adressen protokollieren', help: 'Schreibt die IP-Adressen verbindender Spieler ins Server-Log.' },
  'max-chained-neighbor-updates': { label: 'Maximale verkettete Updates', help: 'Begrenzt Kettenreaktionen von Blockupdates. -1 hebt die Grenze auf.' },
  'max-tick-time': { label: 'Maximale Tick-Dauer (ms)', help: 'Wenn ein Tick länger dauert, stürzt der Watchdog den Server ab. -1 schaltet ihn aus.' },
  'pause-when-empty-seconds': { label: 'Pause ohne Spieler (Sekunden)', help: 'Nach dieser Zeit ohne Spieler pausiert der Server. -1 schaltet es aus.' },
  'sync-chunk-writes': { label: 'Chunks synchron schreiben', help: 'Sicherer bei Abstürzen, aber langsamer beim Speichern.' },
  'use-native-transport': { label: 'Natives Netzwerk (Linux)', help: 'Nutzt unter Linux optimierten Netzwerkcode.' },
  'region-file-compression': { label: 'Kompression der Regionsdateien', help: 'Verfahren, mit dem die Welt gespeichert wird.' },
  'text-filtering-config': { label: 'Textfilter-Konfiguration', help: 'Pfad oder Name einer Konfiguration für den Chat-Filter.' },
} satisfies Record<KnownPropertyKey, PropertyText>;

export const world = {
  loading: 'Welt-Einstellungen werden geladen …',
  loadFailed: 'Die Welt-Einstellungen konnten nicht geladen werden',
  noFile: 'Die Datei server.properties entsteht beim ersten Start des Servers. Gespeicherte Werte werden dann angelegt.',
  allTitle: 'Alle Einstellungen',
  intro: 'Alle Einträge der server.properties. Kommentare und Reihenfolge der Datei bleiben beim Speichern erhalten.',
  levelChangedTitle: 'Neue Welt beim nächsten Start',
  levelChanged: (from: string, to: string) =>
    `Der Weltname wurde von „${from}“ zu „${to}“ geändert. Beim nächsten Start nutzt der Server den Ordner „${to}“ und legt ihn neu an, falls er noch nicht existiert. Die bisherige Welt „${from}“ bleibt unverändert auf der Festplatte.`,
  levelNameEditedHint: 'Ein anderer Weltname legt beim nächsten Start eine neue Welt an. Die bisherige Welt bleibt auf der Festplatte.',
  saved: 'Gespeichert.',
  saveFailed: 'Die Einstellungen wurden nicht gespeichert',
  invalidValues: 'Einige Werte sind ungültig. Bitte die markierten Felder korrigieren.',
  liveRiskTitle: 'Der Server läuft',
  liveRisk:
    'Konsolenbefehle wie /whitelist oder /setidletimeout sowie der nächste Serverstart können die hier vorgenommenen Änderungen während des Laufs überschreiben. Bitte den Server zuerst stoppen und die Änderungen danach speichern.',

  facts: {
    title: 'Diese Welt',
    levelName: 'Weltname',
    seed: 'Seed',
    seedRandom: '(zufällig)',
    levelType: 'Welttyp',
    hardcore: 'Hardcore',
    gamemode: 'Spielmodus',
    difficulty: 'Schwierigkeit',
    yes: 'Ja',
    no: 'Nein',
  },

  search: {
    label: 'Einstellungen durchsuchen',
    placeholder: 'Name, Schlüssel oder Beschreibung',
    onlyChanged: 'Nur Abweichungen vom Standard',
    none: 'Keine Einstellung passt zur Suche.',
    noneChanged: 'Alle angezeigten Einstellungen haben ihren Standardwert.',
  },

  categories: {
    world: { title: 'Welt', description: 'Generierung, Spawns und Reichweiten.' },
    gameplay: { title: 'Spielregeln', description: 'Spielmodus, Schwierigkeit und Regeln im Spiel.' },
    players: { title: 'Spieler', description: 'Spielerzahl, Zugang und Ressourcenpaket.' },
    network: { title: 'Netzwerk', description: 'Port, Serverliste und Fernzugriff.' },
    advanced: { title: 'Erweitert', description: 'Leistung, Protokollierung und Sicherheitsgrenzen.' },
    other: { title: 'Sonstige Einträge', description: 'Einträge der Datei, die LanQuarry nicht kennt, z. B. von Mods oder Plugins.' },
  },

  field: {
    defaultValue: (value: string) => `Standard: ${value === '' ? '(leer)' : value}`,
    notInFile: 'nicht in der Datei',
    changed: 'Geändert',
    unknown: 'unbekannter Eintrag',
    integerInvalid: (min: number | undefined, max: number | undefined) =>
      min !== undefined && max !== undefined
        ? `Eine ganze Zahl von ${min} bis ${max} eingeben.`
        : min !== undefined
          ? `Eine ganze Zahl ab ${min} eingeben.`
          : max !== undefined
            ? `Eine ganze Zahl bis ${max} eingeben.`
            : 'Eine ganze Zahl eingeben.',
    levelNameInvalid: 'Der Weltname muss ein einfacher Ordnername sein: ohne Pfadangaben, Sonderzeichen oder Leerzeichen am Rand.',
    valueTooLong: (max: number) => `Höchstens ${max} Zeichen.`,
    invalidValue: 'Ungültiger Wert.',
    showSecret: 'Anzeigen',
    hideSecret: 'Verbergen',
    secretLabel: (label: string) => `${label}: Wert anzeigen oder verbergen`,
    remove: 'Entfernen',
    removeLabel: (key: string) => `Eintrag ${key} entfernen`,
    undoRemove: 'Rückgängig',
    undoRemoveLabel: (key: string) => `Entfernen von ${key} rückgängig machen`,
    markedForRemoval: 'Wird beim Speichern entfernt',
    newEntry: 'neu',
  },

  options: {
    survival: 'Überleben',
    creative: 'Kreativ',
    adventure: 'Abenteuer',
    spectator: 'Zuschauer',
    peaceful: 'Friedlich',
    easy: 'Einfach',
    normal: 'Normal',
    hard: 'Schwer',
    deflate: 'deflate (Standard)',
    lz4: 'lz4 (schnell)',
    none: 'keine Kompression',
  },

  add: {
    title: 'Eigenen Eintrag hinzufügen',
    description: 'Für Schlüssel, die LanQuarry nicht kennt, z. B. von Mods oder neueren Minecraft-Versionen.',
    keyLabel: 'Schlüssel',
    keyPlaceholder: 'z. B. my-mod.option',
    valueLabel: 'Wert',
    submit: 'Eintrag vormerken',
    keyRequired: 'Bitte einen Schlüssel eingeben.',
    keyInvalid: 'Ungültiger Schlüssel: Buchstaben, Ziffern, Punkt, Minus und Unterstrich, höchstens 64 Zeichen.',
    keyExists: 'Diesen Schlüssel gibt es schon.',
    hint: 'Der Eintrag wird erst mit „Änderungen speichern“ in die Datei geschrieben.',
  },

  bar: {
    changes: (n: number) => (n === 0 ? 'Keine Änderungen' : n === 1 ? '1 Änderung' : `${n} Änderungen`),
    save: 'Änderungen speichern',
    discard: 'Verwerfen',
    fixErrors: 'Vor dem Speichern bitte die markierten Fehler beheben.',
  },

  props,
};

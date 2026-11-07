import type { ErrorParamsMap } from '@craftmanager/backend/contract';

// Text for a backend error `code`. A function receives the error's params and details (params win), so a code is
// translated from the same values in both languages. Every known code is translated here; the backend's English message
// is only the fallback for codes that are not listed.
// Reading rule: a required param is read directly (when it is missing, a reference falls back to the English text);
// an optional param is read with `opt`, which never counts as missing.
type Details = Record<string, unknown>;

const opt = (values: Details, key: string): unknown => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

// disk sizes arrive in MB; a 50 GB world is easier to read as GB
const sizeMb = (mb: number): string => (mb >= 1024 ? `${(mb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB` : `${mb.toLocaleString('de-DE')} MB`);

const named = (details: Details): string | undefined => text(opt(details, 'name'));
const levelOf = (details: Details): number | undefined => num(opt(details, 'level'));

const seconds = (details: Details): number => num(details.seconds) ?? num(opt(details, 'retryAfterSeconds')) ?? 0;

// names of a list of { name } objects, e.g. the dependents of a mod or the servers that use a Java runtime
const namesOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((entry: unknown) => {
        const name = typeof entry === 'object' && entry !== null ? (entry as { name?: unknown }).name : undefined;
        return typeof name === 'string' && name !== '' ? [name] : [];
      })
    : [];
// the servers of a Java runtime: the params carry the names as text, the details as a list of { name } objects
const serverNames = (details: Details): string => (typeof details.servers === 'string' ? details.servers : namesOf(details.servers).join(', '));
// "21", "17 bis 21" or "21 oder neuer" (requiredMax null), or undefined when the details carry no requirement
const javaRange = (details: Details): string | undefined => {
  const min = num(opt(details, 'required'));
  if (min === undefined) return undefined;
  if (opt(details, 'requiredMax') === null) return `${min} oder neuer`;
  const max = num(opt(details, 'requiredMax'));
  return max !== undefined && max !== min ? `${min} bis ${max}` : `${min}`;
};

export const errors = {
  unknown: 'Unbekannter Fehler.',
  unexpectedStatus: (status: number) => `Der Server hat unerwartet geantwortet (Status ${status}).`,
  // replaces the text of a validation detail; the path of the detail is shown in front of it
  invalidDetail: 'ungültiger Wert',
  codes: {
    NETWORK_ERROR: 'Der Server ist nicht erreichbar. Bitte die Netzwerkverbindung prüfen.',
    INVALID_RESPONSE: 'Die Antwort des Servers ist unlesbar.',
    UNAUTHORIZED: 'Anmeldung erforderlich. Bitte anmelden.',
    INVALID_TOKEN: 'Das Passwort bzw. Zugriffstoken ist ungültig.',
    TOO_MANY_ATTEMPTS: (p: Details) => `Zu viele fehlgeschlagene Anmeldeversuche. Bitte in ${seconds(p)} Sekunden erneut versuchen.`,
    CURRENT_PASSWORD_WRONG: 'Das aktuelle Passwort ist falsch.',
    PASSWORD_UNCHANGED: 'Das neue Passwort muss sich vom bisherigen unterscheiden.',
    PASSWORD_TOO_WEAK: 'Das neue Passwort erfüllt die Anforderungen nicht (Länge und mindestens vier verschiedene Zeichen).',
    ORIGIN_FORBIDDEN: 'Die Anfrage stammt von einer nicht erlaubten Herkunft und wurde abgelehnt.',
    HOST_FORBIDDEN: 'Der Host der Anfrage ist nicht erlaubt. Weitere Namen lassen sich über ALLOWED_HOSTS oder in der Weboberfläche unter System > Netzwerk & Zugriff freigeben.',
    FORBIDDEN: 'Der Zugriff auf diese Adresse ist nicht erlaubt.',
    VALIDATION_ERROR: 'Die Anfrage enthält ungültige Daten.',
    PAYLOAD_TOO_LARGE: 'Die Anfrage ist zu groß.',
    UNSUPPORTED_MEDIA_TYPE: 'Der Inhaltstyp der Anfrage wird nicht unterstützt.',
    NOT_FOUND: 'Die angeforderte Ressource wurde nicht gefunden.',
    INTERNAL_ERROR: 'Es ist ein interner Fehler aufgetreten.',
    SHUTTING_DOWN: 'Die Anwendung wird gerade beendet.',
    DATABASE_UNAVAILABLE: 'Die Datenbank ist nicht erreichbar.',
    SERVER_NOT_FOUND: 'Der Server wurde nicht gefunden.',
    SERVER_ALREADY_RUNNING: 'Der Server läuft bereits oder startet gerade.',
    SERVER_NOT_RUNNING: 'Der Server läuft nicht.',
    SERVER_NOT_INSTALLED: 'Der Server ist noch nicht installiert, die Installation läuft noch oder ist fehlgeschlagen.',
    SERVER_RUNNING: 'Der Server läuft gerade. Bitte zuerst stoppen, bevor ein Backup wiederhergestellt wird.',
    SERVER_FILES_MISSING: 'Die Startdatei des Servers fehlt. Bitte die Installation erneut starten.',
    ALREADY_INSTALLED: 'Der Server ist bereits installiert.',
    INSTALL_IN_PROGRESS: 'Die Installation läuft bereits.',
    INSTALL_ABORTED: 'Die Installation wurde unterbrochen (Anwendung wird beendet).',
    INSTALLER_FAILED: (p: Details): string => {
      if (opt(p, 'reason') !== 'exit') return 'Der Installer konnte nicht gestartet werden. Ist die Java-Datei gültig?';
      const code = opt(p, 'exitCode');
      const output = text(opt(p, 'output'));
      return `Der Installer ist mit Exit-Code ${typeof code === 'number' || typeof code === 'string' ? (code === 'unknown' ? 'unbekannt' : code) : 'unbekannt'} fehlgeschlagen.${output === undefined ? '' : `\nLetzte Ausgabe:\n${output}`}`;
    },
    INSTALLER_TIMEOUT: (p: Details) =>
      num(p.minutes) === undefined ? 'Der Installer wurde wegen Zeitüberschreitung abgebrochen.' : `Der Installer wurde nach ${p.minutes} Minuten wegen Zeitüberschreitung abgebrochen.`,
    INSTALL_LOG_UNSAFE: 'Die Protokolldatei ist keine normale Datei und wird nicht gelesen.',
    LAUNCH_TARGET_NOT_FOUND: 'Nach der Installation wurde keine startbare Datei gefunden. Details stehen in der Datei install.log im Serverordner.',
    START_CANCELLED: 'Der Start wurde abgebrochen.',
    START_FAILED: (p: Details): string => {
      const reason = text(opt(p, 'reason'));
      if (reason === 'java-not-found') return 'Der Server konnte nicht gestartet werden: Die passende Java-Installation fehlt.';
      if (reason === 'java-denied') return 'Der Server konnte nicht gestartet werden: Das Java-Programm darf nicht ausgeführt werden.';
      if (reason === 'spawn-failed') return 'Der Server konnte nicht gestartet werden: Der Serverprozess konnte nicht gestartet werden.';
      return 'Der Server konnte nicht gestartet werden.';
    },
    CONFIRMATION_REQUIRED: 'Zum Löschen muss der Parameter confirm=true angegeben werden.',
    INVALID_COMMAND: 'Der Befehl darf nicht leer sein.',
    INVALID_MESSAGE: 'Die Nachricht ist ungültig.',
    RAM_INVALID: 'Der minimale Arbeitsspeicher darf nicht größer sein als der maximale.',
    RAM_EXCEEDS_SYSTEM: (details: Details) =>
      num(opt(details, 'maxRamMb')) === undefined || num(opt(details, 'totalRamMb')) === undefined
        ? 'Der maximale Arbeitsspeicher übersteigt den verfügbaren Arbeitsspeicher des Rechners.'
        : `Der maximale Arbeitsspeicher (${details.maxRamMb} MB) übersteigt den Arbeitsspeicher dieses Rechners (${details.totalRamMb} MB).`,
    INVALID_JVM_ARGS: 'Die zusätzlichen JVM-Argumente sind ungültig.',
    EULA_NOT_ACCEPTED: 'Die Minecraft-EULA wurde für diesen Server noch nicht akzeptiert. Zustimmung ist erforderlich, bevor der Server starten kann.',
    PORT_IN_USE: (details: Details) =>
      num(opt(details, 'port')) === undefined
        ? 'Der Port wird bereits verwendet oder darf nicht genutzt werden. Bitte in den Servereigenschaften einen anderen Port einstellen.'
        : text(opt(details, 'serverName')) === undefined
          ? `Port ${details.port} wird bereits von einem anderen Programm verwendet oder darf nicht genutzt werden. Bitte das Programm beenden oder in den Servereigenschaften einen anderen Port einstellen.`
          : `Port ${details.port} wird bereits vom laufenden Server „${details.serverName}“ verwendet. Bitte in den Servereigenschaften einen anderen Port einstellen.`,
    JAVA_INVALID: 'Der Java-Pfad muss auf eine Datei namens java bzw. java.exe zeigen.',
    JAVA_INSTALL_ABORTED: 'Die Java-Installation wurde abgebrochen.',
    JAVA_INSTALL_INVALID: (p: Details) =>
      num(p.major) === undefined ? 'Das heruntergeladene Archiv enthält keine Java-Installation.' : `Das heruntergeladene Archiv für Java ${p.major} enthält keine Java-Installation.`,
    JAVA_INSTALL_UNAVAILABLE: 'Die Java-Installation ist in dieser Konfiguration nicht verfügbar.',
    JAVA_INSTALL_RUNNING: (p: Details) =>
      num(p.major) === undefined ? 'Java wird gerade installiert und kann nicht entfernt werden.' : `Java ${p.major} wird gerade installiert und kann nicht entfernt werden.`,
    JAVA_IN_USE: (p: Details) =>
      serverNames(p) === ''
        ? 'Java wird gerade von Servern verwendet. Bitte zuerst die Server stoppen.'
        : `Diese Java-Laufzeit wird gerade von folgenden Servern verwendet: ${serverNames(p)}. Bitte zuerst die Server stoppen.`,
    JAVA_RUNTIME_NOT_FOUND: (p: Details) =>
      num(p.major) === undefined
        ? 'Es ist keine von LanQuarry installierte Java-Laufzeit für diese Version vorhanden.'
        : `Für Java ${p.major} ist keine von LanQuarry installierte Java-Laufzeit vorhanden.`,
    JAVA_NOT_AVAILABLE: (details: Details) =>
      num(opt(details, 'major')) === undefined || text(opt(details, 'platform')) === undefined
        ? 'Für diese Plattform bietet Eclipse Temurin keine passende Java-Version an. Bitte Java manuell installieren und den Pfad im Server eintragen.'
        : `Eclipse Temurin bietet für ${details.platform} kein Java ${details.major} an. Bitte Java ${details.major} manuell installieren und den Pfad im Server eintragen.`,
    JAVA_NOT_FOUND: (details: Details) => {
      if (text(opt(details, 'javaPath')) !== undefined) return `Die konfigurierte Java-Installation wurde nicht gefunden oder startet nicht: ${details.javaPath}`;
      const range = num(opt(details, 'major')) !== undefined ? `${details.major}` : javaRange(details);
      return range === undefined
        ? 'Es wurde keine passende Java-Installation gefunden. Bitte Java installieren oder im Server den Java-Pfad angeben.'
        : `Es wurde keine Java-Installation gefunden. Benötigt wird Java ${range}. Bitte Java installieren oder im Server den Java-Pfad angeben.`;
    },
    JAVA_VERSION_INCOMPATIBLE: (details: Details) => {
      const range = javaRange(details);
      if (range === undefined) return 'Die installierte Java-Version passt nicht zu diesem Server.';
      const found = Array.isArray(opt(details, 'found')) ? (details.found as unknown[]).filter((version): version is number => typeof version === 'number') : [];
      return found.length === 0 ? `Dieser Server benötigt Java ${range}.` : `Dieser Server benötigt Java ${range}, gefunden wurde Java ${[...new Set(found)].join(', ')}.`;
    },
    JAVA_PLATFORM_UNSUPPORTED: 'Für diese Plattform bietet Eclipse Temurin keine Java-Laufzeit an. Bitte Java manuell installieren und den Pfad im Server eintragen.',
    BACKUP_NOT_FOUND: 'Das Backup wurde nicht gefunden.',
    BACKUP_IN_PROGRESS: 'Für diesen Server läuft bereits ein Backup.',
    BACKUP_FILE_MISSING: 'Die Backup-Datei fehlt im Datenordner.',
    BACKUP_INVALID: 'Das Backup enthält keine gültige Beschreibung (craftmanager-backup.json) und kann nicht wiederhergestellt werden.',
    BACKUP_NOT_READY: 'Dieses Backup ist nicht abgeschlossen und kann nicht heruntergeladen werden.',
    BACKUP_PATH_UNSAFE: 'Der Dateiname des Backups ist ungültig.',
    BACKUP_SERVER_BUSY: 'Der Server startet oder stoppt gerade. Bitte warten, bis er läuft oder gestoppt ist.',
    BACKUP_INTERRUPTED: 'Der Server wurde während der Sicherung gestoppt. Die unvollständige Sicherung wurde verworfen.',
    BACKUP_SAVE_FAILED: 'Der Server konnte die Welt nicht speichern (save-all). Ist genug Speicherplatz frei?',
    BACKUP_SAVE_TIMEOUT: 'Der Server hat das Speichern der Welt nicht rechtzeitig bestätigt.',
    BACKUP_NOTHING_TO_SAVE: 'Es gibt noch keine Weltdaten zu sichern. Der Server muss einmal gestartet worden sein.',
    BACKUP_LEVEL_INVALID: (p: Details) =>
      text(p.levelName) === undefined
        ? 'Der Weltname (level-name) in der server.properties ist ungültig und kann nicht gesichert werden.'
        : `Der Weltname „${p.levelName}“ (level-name in der server.properties) ist ungültig und kann nicht gesichert werden.`,
    BACKUP_TOO_DEEP: 'Die Ordnerstruktur der Welt ist zu tief verschachtelt.',
    BACKUPS_DECISION_REQUIRED: 'Für diesen Server gibt es Backups. Bitte festlegen, ob sie mit dem Server gelöscht oder behalten werden.',
    ARCHIVE_BOMB: 'Das Archiv ist entpackt unverhältnismäßig groß im Vergleich zu seiner Dateigröße und wird aus Sicherheitsgründen abgelehnt.',
    ARCHIVE_PATH_TOO_LONG: (p: Details) =>
      text(p.path) === undefined ? 'Ein Dateipfad im Archiv ist zu lang für ein ZIP-Archiv.' : `Der Dateipfad „${p.path}“ im Archiv ist zu lang für ein ZIP-Archiv.`,
    ARCHIVE_SOURCE_CHANGED: (p: Details) =>
      text(p.file) === undefined
        ? 'Eine Datei hat sich während der Sicherung verändert. Bitte erneut versuchen.'
        : `Die Datei „${p.file}“ hat sich während der Sicherung verändert. Bitte erneut versuchen.`,
    ARCHIVE_TOO_LARGE: 'Das Archiv ist größer als erlaubt (zu viele Einträge oder entpackt zu groß).',
    ARCHIVE_UNSAFE: (p: Details) =>
      text(p.entry) === undefined
        ? 'Das Archiv enthält einen unzulässigen Eintrag. Der Vorgang wurde abgebrochen.'
        : `Das Archiv enthält den unzulässigen Eintrag „${p.entry}“. Der Vorgang wurde abgebrochen.`,
    EXPORT_MANIFEST_INVALID: 'Die Manifest-Datei des Exports ist ungültig. Sie stammt vermutlich von einer neueren Version.',
    EXPORT_NOTHING: 'Es gibt noch keine Weltdaten zu exportieren bzw. das Backup enthält keine Welt.',
    CHECKSUM_UNAVAILABLE: 'Für den Installer ist keine Prüfsumme veröffentlicht. Der Download wird aus Sicherheitsgründen abgebrochen.',
    FILE_EXISTS: (p: Details) =>
      text(p.file) === undefined
        ? 'Eine Datei mit diesem Namen existiert bereits im Serverordner.'
        : `Die Datei „${p.file}“ existiert bereits im Serverordner.`,
    FILE_LOCKED: (details: Details) =>
      text(details.fileName) === undefined
        ? 'Die Datei wird von einem anderen Programm verwendet oder ist schreibgeschützt. Bitte das Programm (z. B. den Minecraft-Server) beenden und erneut versuchen.'
        : `Die Datei „${details.fileName}“ wird von einem anderen Programm verwendet oder ist schreibgeschützt. Bitte das Programm (z. B. den Minecraft-Server) beenden und erneut versuchen.`,
    DOWNLOAD_FAILED: (p: Details) =>
      num(p.status) === undefined ? 'Der Download konnte nicht gestartet werden.' : `Der Download konnte nicht gestartet werden (Status ${p.status}).`,
    DOWNLOAD_HASH_MISMATCH: 'Die heruntergeladene Datei stimmt nicht mit der erwarteten Prüfsumme überein.',
    DOWNLOAD_INVALID_FILE: 'Die heruntergeladene Datei ist kein gültiges Java-Archiv.',
    DOWNLOAD_TIMEOUT: 'Der Download hat zu lange gedauert.',
    DOWNLOAD_URL_REJECTED: (p: Details) =>
      text(p.host) === undefined ? 'Die Download-Adresse ist ungültig.' : `Die Download-Adresse („${p.host}“) ist ungültig.`,
    DEPENDENCY_UNRESOLVABLE: 'Die Version enthält keine herunterladbare .jar-Datei.',
    MODRINTH_BAD_RESPONSE: 'Modrinth hat eine unerwartete Antwort geliefert.',
    MODRINTH_RATE_LIMITED: 'Modrinth begrenzt gerade die Anfragen. Bitte später erneut versuchen.',
    MODRINTH_TIMEOUT: 'Modrinth hat nicht rechtzeitig geantwortet.',
    MODRINTH_UNREACHABLE: 'Modrinth ist nicht erreichbar.',
    MODS_NOT_SUPPORTED: 'Vanilla-Server unterstützen keine Mods oder Plugins.',
    MOD_NOT_FOUND: 'Das Projekt oder die Version wurde bei Modrinth nicht gefunden.',
    MOD_ALREADY_INSTALLED: (p: Details) => (text(p.name) === undefined ? 'Dieser Mod ist bereits installiert.' : `Der Mod „${p.name}“ ist bereits installiert.`),
    MOD_DISABLED: (p: Details) =>
      text(p.name) === undefined
        ? 'Dieser Mod ist installiert, aber deaktiviert. Bitte in der Mod-Liste aktivieren.'
        : `Der Mod „${p.name}“ ist installiert, aber deaktiviert. Bitte in der Mod-Liste aktivieren.`,
    MOD_FILE_MISSING: (p: Details) =>
      text(p.file) === undefined || text(p.name) === undefined
        ? 'Die Datei dieses Mods fehlt im Serverordner. Bitte die Mod-Liste neu einlesen.'
        : `Die Datei „${p.file}“ des Mods „${p.name}“ fehlt im Serverordner. Bitte die Mod-Liste neu einlesen.`,
    MOD_INCOMPATIBLE: (p: Details) => {
      const mods = Array.isArray(opt(p, 'mods')) ? (p.mods as unknown[]).filter((mod): mod is string => typeof mod === 'string') : [];
      if (text(opt(p, 'first')) !== undefined && text(opt(p, 'second')) !== undefined) return `„${p.first}“ ist nicht mit „${p.second}“ kompatibel.`;
      return mods.length === 2 ? `„${mods[0]}“ ist nicht mit „${mods[1]}“ kompatibel.` : 'Diese beiden Mods sind nicht miteinander kompatibel.';
    },
    MOD_REQUIRED_BY_OTHERS: (p: Details) => {
      const names = typeof opt(p, 'dependents') === 'string' ? (p.dependents as string) : namesOf(opt(p, 'dependents')).join(', ');
      return names === '' ? 'Dieser Mod wird von anderen Mods benötigt.' : `Dieser Mod wird von anderen Mods benötigt: ${names}.`;
    },
    MOD_VERSION_DIFFERS: 'Eine andere Version dieses Mods ist bereits installiert. Bitte die Update-Funktion verwenden.',
    PLAN_TOO_LARGE: (p: Details) =>
      num(p.max) === undefined
        ? 'Die Abhängigkeiten umfassen mehr Mods als erlaubt. Die Installation wurde abgebrochen.'
        : `Die Abhängigkeiten umfassen mehr als ${p.max} Mods. Die Installation wurde abgebrochen.`,
    NO_COMPATIBLE_VERSION: 'Es gibt keine passende Version für diese Minecraft-Version und diesen Loader.',
    VERSION_INCOMPATIBLE: 'Die gewählte Version ist mit dieser Minecraft-Version und diesem Loader nicht kompatibel.',
    VERSION_NOT_FOUND: 'Die angeforderte Version wurde nicht gefunden.',
    NO_SERVER_DOWNLOAD: 'Mojang stellt für diese Minecraft-Version keinen Server zum Download bereit. Bitte eine andere Version wählen.',
    UNSAFE_FILENAME: 'Die Quelle hat einen unzulässigen Dateinamen geliefert. Der Download wurde abgebrochen.',
    NBT_INVALID: 'Die NBT-Datei ist beschädigt.',
    IMPORT_BEDROCK: 'Das Archiv enthält eine Bedrock-Welt. LanQuarry unterstützt nur Welten der Java Edition.',
    IMPORT_BUSY: 'Es laufen bereits mehrere Importe. Bitte warten, bis einer abgeschlossen ist.',
    IMPORT_IN_PROGRESS: 'Der Import läuft gerade und kann nicht abgebrochen werden.',
    IMPORT_MODE: 'Dieser Upload ist zum Ersetzen einer Welt bestimmt.',
    IMPORT_NOT_FOUND: 'Der Import wurde nicht gefunden oder ist abgelaufen. Bitte das Archiv erneut hochladen.',
    IMPORT_NOT_READY: (p: Details) =>
      text(opt(p, 'reason')) === undefined
        ? 'Der Import ist fehlgeschlagen oder noch nicht bereit.'
        : `Der Import ist fehlgeschlagen oder noch nicht bereit: ${p.reason}`,
    IMPORT_NO_WORLD: 'Im Archiv wurde keine Minecraft-Welt gefunden (keine Datei level.dat).',
    IMPORT_FORMAT_UNSUPPORTED: 'Das Archiv hat ein nicht unterstütztes Format. Unterstützt werden .zip und .tar.gz (.tgz).',
    IMPORT_TOO_LARGE: (p: Details) =>
      text(opt(p, 'max')) === undefined
        ? 'Die Datei ist zu groß. Das Limit lässt sich mit IMPORT_MAX_MB anpassen.'
        : `Die Datei ist zu groß (höchstens ${p.max}). Das Limit lässt sich mit IMPORT_MAX_MB anpassen.`,
    IMPORT_TOO_MANY_MODS: 'Das Archiv enthält zu viele Mod-Dateien und wird nicht importiert.',
    IMPORT_SELECTION_INVALID: 'Die Auswahl enthält eine Mod-Datei, die nicht im Archiv liegt.',
    IMPORT_FAILED: 'Die Welt konnte nicht vollständig übernommen werden. Der Server wurde angelegt; die Welt lässt sich über „Welt ersetzen“ erneut importieren.',
    LEVEL_DAT_INVALID: 'Die Datei level.dat konnte nicht gelesen werden.',
    ARCHIVE_CORRUPT: 'Das Archiv ist beschädigt oder unvollständig.',
    ARCHIVE_UNSUPPORTED: 'Das Archiv verwendet ein nicht unterstütztes Kompressionsverfahren.',
    DISK_FULL: (p: Details) => {
      const needed = num(p.neededMb);
      const free = num(p.freeMb);
      return needed === undefined || free === undefined ? 'Auf dem Datenträger ist nicht genug Speicherplatz frei.' : `Auf dem Datenträger ist nicht genug Speicherplatz frei (benötigt ${sizeMb(needed)}, frei ${sizeMb(free)}).`;
    },
    EXPORT_INTERRUPTED: 'Der Server wurde während des Exports gestoppt. Der unvollständige Export wurde verworfen.',
    EXPORT_IN_PROGRESS: 'Der Export läuft noch.',
    EXPORT_NOT_FOUND: 'Der Export wurde nicht gefunden oder ist abgelaufen.',
    EXPORT_NOT_READY: 'Der Export ist noch nicht fertig.',
    EXPORT_SERVER_BUSY: 'Der Server startet oder stoppt gerade. Bitte warten, bis er läuft oder gestoppt ist.',
    NETWORK_PORT_INVALID: 'Der Port muss eine ganze Zahl zwischen 1 und 65535 sein.',
    NETWORK_PUBLIC_INVALID: 'Die öffentliche Adresse ist ungültig. Beispiele: minecraft.fritz.box oder http://192.168.178.20:3000',
    NETWORK_ADDRESS_INVALID: 'Die Adresse ist keine gültige IPv4-Adresse. Erlaubt sind 0.0.0.0 (alle Adapter), 127.0.0.1 (nur dieser Rechner) oder eine Adresse dieses Rechners.',
    NETWORK_ADDRESS_UNKNOWN: 'Die Adresse gehört zu keinem Netzwerkadapter dieses Rechners. Mit einer nicht vorhandenen Adresse wäre LanQuarry nicht erreichbar.',
    NETWORK_HOST_INVALID: 'Ungültiger Rechnername. Namen wie minecraft.fritz.box sind erlaubt (ohne http:// und ohne Pfad). Außerdem gibt es eine Obergrenze für zusätzliche Namen.',
    NETWORK_PORT_DENIED: 'Für diesen Port fehlt die Berechtigung (Ports unter 1024 sind bei normalen Benutzerkonten gesperrt). Bitte einen höheren Port wählen.',
    NETWORK_PORT_IN_USE: (p: Details) =>
      text(opt(p, 'server')) === undefined
        ? 'Der Port ist bereits belegt, durch ein anderes Programm oder einen Minecraft-Server. Bitte einen freien Port wählen.'
        : `Der Port ist bereits vom Server „${p.server}“ belegt. Bitte einen freien Port wählen.`,
    RESTART_CONFIRM_REQUIRED: 'Der Neustart muss ausdrücklich bestätigt werden: Alle laufenden Minecraft-Server werden dabei gestoppt und danach wieder gestartet.',
    RESTART_IN_PROGRESS: 'LanQuarry startet bereits neu.',
    RESTART_UNSUPPORTED: 'In dieser Betriebsart ist kein Neustart aus der Oberfläche möglich.',
    UPDATE_ABORTED: 'Der Vorgang wurde abgebrochen.',
    UPDATE_BLOCKED: (p: Details) => (text(p.reason) === undefined ? 'Das Update ist im Moment blockiert. Bitte später erneut versuchen.' : `Das Update ist im Moment blockiert: ${p.reason}`),
    UPDATE_BUSY: 'Es läuft gerade ein Update. Eine neue Prüfung ist danach möglich.',
    UPDATE_CANCELLED: 'Das Update wurde abgebrochen.',
    UPDATE_CHECK_FAILED: 'Die Suche nach Updates ist fehlgeschlagen.',
    UPDATE_CONFIRM_REQUIRED: 'Das Update muss ausdrücklich bestätigt werden: Alle laufenden Minecraft-Server werden dabei gestoppt.',
    UPDATE_DISABLED: 'Update-Prüfungen sind in der Konfiguration abgeschaltet (UPDATE_CHECK=false).',
    UPDATE_DOWNLOAD_FAILED: (p: Details) =>
      num(p.status) === undefined ? 'Der Update-Download ist fehlgeschlagen.' : `Der Update-Download ist fehlgeschlagen (Status ${p.status}).`,
    UPDATE_HASH_MISMATCH: 'Die heruntergeladene Datei passt nicht zur signierten Prüfsumme. Das Update wurde abgelehnt.',
    UPDATE_IN_PROGRESS: (p: Details) =>
      text(opt(p, 'reason')) === undefined
        ? 'LanQuarry wird gerade aktualisiert. Server können erst danach wieder gestartet, installiert oder verändert werden.'
        : `${p.reason}`,
    UPDATE_NOT_APPLIED: 'Der Update-Dienst meldet Erfolg, aber LanQuarry läuft noch in der alten Version.',
    UPDATE_NOT_CANCELABLE: 'Das Update lässt sich in diesem Schritt nicht mehr abbrechen.',
    UPDATE_NOT_POSSIBLE: (p: Details) =>
      text(opt(p, 'reason')) === undefined ? 'Der Update-Dienst ist nicht eingerichtet.' : `Der Update-Dienst ist nicht eingerichtet: ${p.reason}`,
    UPDATE_NO_UPDATER: 'Der Update-Dienst hat die Anfrage nicht angenommen. Ist der Dienst „craftmanager-update“ bzw. „craftmanager-updater“ aktiv?',
    UPDATE_RESPONSE_INVALID: 'GitHub hat eine unerwartete Antwort geliefert.',
    UPDATE_SIGNATURE_INVALID: 'Die Signatur des Releases ist ungültig. Das Update wurde aus Sicherheitsgründen abgelehnt.',
    UPDATE_SIZE_MISMATCH: 'Die heruntergeladene Datei hat nicht die angekündigte Größe.',
    UPDATE_STOP_TIMEOUT: 'Nicht alle Server ließen sich rechtzeitig stoppen. Das Update wurde nicht eingespielt.',
    UPDATE_SUMS_INVALID: (p: Details) =>
      text(p.asset) === undefined ? 'Die Prüfsummen-Datei des Releases ist fehlerhaft.' : `Die Prüfsummen-Datei des Releases ist fehlerhaft (${p.asset}).`,
    UPDATE_TIMEOUT: 'Die Verbindung zu GitHub hat zu lange gedauert.',
    UPDATE_TOO_LARGE: 'Die Antwort bzw. Update-Datei ist größer als erlaubt und wurde abgelehnt.',
    UPDATE_UNREACHABLE: 'GitHub ist nicht erreichbar. Bitte die Internetverbindung prüfen.',
    UPDATE_URL_REJECTED: (p: Details) =>
      text(p.host) === undefined
        ? 'Die Download-Adresse für das Update ist nicht erlaubt.'
        : `Die Download-Adresse für das Update („${p.host}“) ist nicht erlaubt.`,
    UPLOAD_ABORTED: 'Der Upload wurde abgebrochen.',
    UPLOAD_EMPTY: 'Es wurde keine Datei übertragen.',
    UPSTREAM_ERROR: (p: Details) =>
      text(p.host) === undefined
        ? 'Ein externer Dienst hat mit einem Fehler geantwortet.'
        : `Der Dienst „${p.host}“ hat mit einem Fehler geantwortet.`,
    UPSTREAM_INVALID: (p: Details) =>
      text(p.host) === undefined
        ? 'Ein externer Dienst hat Daten in einem unerwarteten Format geliefert.'
        : `Der Dienst „${p.host}“ hat Daten in einem unerwarteten Format geliefert.`,
    UPSTREAM_TIMEOUT: (p: Details) =>
      text(p.host) === undefined
        ? 'Ein externer Dienst hat nicht rechtzeitig geantwortet.'
        : `Der Dienst „${p.host}“ hat nicht rechtzeitig geantwortet.`,
    UPSTREAM_UNREACHABLE: (p: Details) =>
      text(p.host) === undefined
        ? 'Ein externer Dienst ist nicht erreichbar. Bitte die Internetverbindung prüfen.'
        : `Der Dienst „${p.host}“ ist nicht erreichbar. Bitte die Internetverbindung prüfen.`,
    UNSAFE_SERVER_PATH: 'Der Serverordner liegt an einem unerwarteten Ort und wird aus Sicherheitsgründen nicht gelöscht.',
    PLAYERS_BUSY: 'Der Server startet oder stoppt gerade. Bitte warten, bis er läuft oder gestoppt ist.',
    PLAYERS_UNSUPPORTED: 'Die Spielerlisten werden erst ab Minecraft 1.7.6 als JSON-Dateien geführt und können für diese Version nicht verwaltet werden.',
    PLAYER_LIST_CORRUPT: 'Eine Spielerliste ist beschädigt und wird nicht überschrieben. Bitte die Datei reparieren oder löschen.',
    PLAYER_NAME_NEEDS_RUNNING_SERVER: (details: Details) =>
      named(details) === undefined
        ? 'Dies ist ein Bedrock-Name (Floodgate/Geyser) ohne Mojang-Konto, die UUID kann bei gestopptem Server nicht ermittelt werden. Bitte den Server starten und den Spieler dort hinzufügen.'
        : `„${named(details)}“ ist ein Bedrock-Name (Floodgate/Geyser) ohne Mojang-Konto, die UUID kann bei gestopptem Server nicht ermittelt werden. Bitte den Server starten und den Spieler dort hinzufügen.`,
    OP_LEVEL_LIVE: (details: Details) =>
      levelOf(details) === undefined
        ? 'Während der Server läuft, wird nur der Standard-Level vergeben. Einen anderen Level oder „Spielerlimit umgehen“ bitte bei gestopptem Server setzen.'
        : `Während der Server läuft, wird nur der Standard-Level (${levelOf(details)}) vergeben. Einen anderen Level oder „Spielerlimit umgehen“ bitte bei gestopptem Server setzen.`,
    PLAYER_NOT_FOUND: (details: Details) =>
      text(details.name) === undefined ? 'Spieler nicht gefunden: Dieser Name existiert bei Mojang nicht.' : `Spieler nicht gefunden: Der Name „${details.name}“ existiert bei Mojang nicht.`,
    PLAYER_NOT_LISTED: (details: Details) => (text(details.name) === undefined ? 'Dieser Eintrag steht nicht in der Liste.' : `„${details.name}“ steht nicht in dieser Liste.`),
    PLAYER_LOOKUP_FAILED: (p: Details): string => {
      const reason = opt(p, 'reason');
      const status = num(opt(p, 'status'));
      const detail =
        reason === 'timeout'
          ? 'Mojang hat nicht rechtzeitig geantwortet.'
          : reason === 'rate-limited'
            ? 'Mojang begrenzt gerade die Anfragen.'
            : reason === 'http' && status !== undefined
              ? `Mojang hat die Anfrage nicht beantwortet (HTTP ${status}).`
              : reason === 'unreachable'
                ? 'Mojang ist nicht erreichbar.'
                : reason === 'unexpected'
                  ? 'Mojang hat unerwartet geantwortet.'
                  : 'Der Spielername konnte bei Mojang nicht nachgeschlagen werden.';
      return `${detail} Alternativ den Server starten und den Spieler dort live hinzufügen.`;
    },
    PROPERTY_NOT_REMOVABLE: 'Der Serverport (server-port) kann nicht entfernt werden. Bitte stattdessen einen neuen Port setzen.',
    REASON_NOT_ASCII: 'Der Grund darf während der Server läuft nur einfache Buchstaben (A–Z) enthalten; Umlaute werden automatisch umgewandelt.',
    WORLD_NEWER:
      'Die Welt wurde zuletzt mit einer neueren Minecraft-Version gespeichert als der gewählten. Eine Welt auf eine ältere Version zurückzusetzen beschädigt sie.',
  },
};

// Compile-time check: every code with params in the backend's ErrorParamsMap has a text above (an uncovered code is
// the type of this constant, which is not `true`).
type UncoveredParamCodes = Exclude<keyof ErrorParamsMap, keyof typeof errors.codes>;
export const paramCodesCovered: [UncoveredParamCodes] extends [never] ? true : UncoveredParamCodes = true;

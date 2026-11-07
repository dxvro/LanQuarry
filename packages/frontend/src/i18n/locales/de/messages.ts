import type { MessageTexts } from '../../types';

// Texts of the backend's message table (contract MessageKey). The English backend text arrives with every message
// and is the fallback; these texts follow the same templates with the same params (see i18n/renderRef.ts).
// The typing against MessageParamsMap makes a missing key or a wrong param a compile error.

// names joined by comma, with the number of further names that were left out
const listOf = (p: { names: string; more: number }): string => (p.more > 0 ? `${p.names} und ${p.more} weitere` : p.names);

// "einer unbekannten Version" or "Minecraft 1.20.1 (geschätzt)"
const worldOf = (p: { worldVersion: string; estimated: 'yes' | 'no' }): string =>
  p.worldVersion === '' ? 'einer unbekannten Version' : `Minecraft ${p.worldVersion}${p.estimated === 'yes' ? ' (geschätzt)' : ''}`;

// wie ein Prozess beendet wurde (Params werden mit `in` gelesen: ein fehlender ist kein fehlender Pflicht-Param)
const exitOf = (p: { code?: number; signal?: string }): string => ('signal' in p ? `Signal ${p.signal}` : 'code' in p ? `Exit-Code ${p.code}` : 'unbekannter Exit-Code');

export const messages: MessageTexts = {
  // ---- console lines and runtime status (process manager) ----
  SERVER_STOPPING: 'Der Server wird gestoppt ...',
  SERVER_RESTARTING: 'Der Server wird neu gestartet ...',
  SERVER_KILLING: 'Der Server wird sofort beendet ...',
  SERVER_STOPPING_APP_SHUTDOWN: 'Die Anwendung wird beendet, der Server wird gestoppt ...',
  SERVER_STARTING: (p) => `Der Server wird gestartet (Java ${p.major}, Port ${p.port}) ...`,
  START_NOTE: (p) => `Hinweis: ${p.note}`,
  START_FAILED_REASON: (p) => `Der Server konnte nicht gestartet werden: ${p.reason}`,
  JAVA_AUTO_INSTALL_NOTICE: (p) =>
    `Java ${p.major} ist nicht installiert und wird jetzt automatisch installiert (Eclipse Temurin, nur für LanQuarry) ...`,
  JAVA_INSTALLING: (p) => `Java ${p.major} wird installiert ...`,
  JAVA_INSTALLING_PERCENT: (p) => `Java ${p.major} wird installiert (${p.percent} %) ...`,
  JAVA_INSTALLED_STARTING: (p) => `Java ${p.major} ist installiert. Der Server wird gestartet ...`,
  JAVA_INSTALL_FAILED_GENERIC: 'Die Java-Installation ist fehlgeschlagen.',
  START_CANCELLED_JAVA: 'Start abgebrochen. Die Java-Installation wird gestoppt.',
  SERVER_EXITED_UNEXPECTEDLY: (p) => `Der Server wurde unerwartet beendet (${exitOf(p)}).`,
  SERVER_STOPPED: (p) => `Server gestoppt (${exitOf(p)}).`,
  SERVER_STOP_TIMEOUT: (p) => `Der Server wurde nicht innerhalb von ${p.seconds} Sekunden gestoppt und wird beendet.`,
  SERVER_NOT_REPORTED_STARTED:
    'Der Server hat noch nicht gemeldet, dass er läuft. Große Modpacks brauchen oft mehrere Minuten; der Server wird deshalb nicht gestoppt.',
  START_UNEXPECTED_ERROR: 'Unerwarteter Fehler beim Starten.',
  JAVA_FORGE_OLD_NOTE:
    'Forge für Minecraft bis 1.16.5 läuft oft nicht mit Java-Versionen, die neuer als 11 sind. Java 8 wird empfohlen.',
  MODS_UPDATE_CHECK_FAILED: 'Die Suche nach Mod-Updates ist fehlgeschlagen.',
  // ---- self-update ----
  UPDATE_CHECKS_DISABLED: 'Update-Prüfungen sind in der Konfiguration abgeschaltet (UPDATE_CHECK=false).',
  UPDATE_ALREADY_RUNNING: 'Ein Update läuft bereits.',
  UPDATE_NO_NEWER: 'Es gibt keine neuere Version.',
  UPDATE_RESTART_BLOCKED: 'Gerade läuft ein Update. Ein Neustart ist danach möglich.',
  UPDATE_CHECK_FAILED_GENERIC: 'Die Suche nach Updates ist fehlgeschlagen.',
  UPDATE_NOTE_PORTABLE:
    'Diese Installation läuft ohne Update-Dienst (portable ZIP oder ältere Installation). Neue Versionen werden angezeigt, aber nicht automatisch installiert: Bitte das neue Paket herunterladen und wie im README (Abschnitt Installation) beschrieben installieren.',
  UPDATE_NOTE_DEV: 'LanQuarry läuft aus dem Quellcode. Updates bitte mit git pull, npm install und npm run build einspielen.',
  UPDATE_NO_PACKAGES: (p) => `Für ${p.platform}/${p.arch} gibt es keine fertigen Update-Pakete.`,
  UPDATE_NO_ASSET: (p) => `Das Release ${p.version} enthält kein Paket für dieses System (${p.asset}).`,
  UPDATE_UNSIGNED_RELEASE:
    'Das Release enthält keine signierten Prüfsummen (SHA256SUMS.txt und SHA256SUMS.txt.sig). Es wird nicht automatisch installiert.',
  UPDATE_WAIT_INSTALL: 'Gerade läuft die Installation eines Servers. Das Update ist danach möglich.',
  UPDATE_WAIT_BACKUP: 'Gerade wird ein Backup geschrieben. Das Update ist danach möglich.',
  UPDATE_WAIT_JAVA: 'Gerade wird eine Java-Laufzeit installiert. Das Update ist danach möglich.',
  UPDATE_WAIT_EXPORT: 'Gerade wird eine Welt exportiert. Das Update ist danach möglich.',
  UPDATE_WAIT_IMPORT: 'Gerade läuft ein Welt-Import. Das Update ist danach möglich.',
  UPDATE_PROGRESS_DOWNLOADING: (p) => `Update auf ${p.version} wird heruntergeladen …`,
  UPDATE_PROGRESS_VERIFYING: 'Signatur und Prüfsumme werden geprüft …',
  UPDATE_PROGRESS_NO_SERVERS: 'Es laufen keine Server. Das Update wird übergeben …',
  UPDATE_PROGRESS_COUNTDOWN: (p) => `Die Server werden in ${p.seconds} s gestoppt (Spieler wurden gewarnt).`,
  UPDATE_PROGRESS_STOPPING: (p) => `${p.count === 1 ? '1 Server wird' : `${p.count} Server werden`} gestoppt …`,
  UPDATE_PROGRESS_DB_BACKUP: 'Die Datenbank wird gesichert …',
  UPDATE_PROGRESS_HANDOVER: 'Das Update wird an den Update-Dienst übergeben …',
  UPDATE_PROGRESS_RESTARTING: 'LanQuarry startet neu. Diese Seite verbindet sich automatisch wieder.',
  UPDATE_PROGRESS_CHECKING_PACKAGE: 'Der Update-Dienst prüft das Paket …',
  UPDATE_PROGRESS_FINISHING: 'Das Update wird abgeschlossen …',
  UPDATE_CANCELLED_BY_ADMIN: 'Vom Administrator abgebrochen.',
  UPDATE_REJECTED_BY_UPDATER: 'Der Update-Dienst hat das Update abgelehnt.',
  UPDATE_FAILED_UNEXPECTED: 'Das Update ist aus einem unerwarteten Grund fehlgeschlagen.',
  UPDATE_SUCCESS: (p) => `Auf Version ${p.version} aktualisiert.`,
  UPDATE_ROLLED_BACK_DEFAULT: 'Das Update ist fehlgeschlagen, die vorherige Version wurde wiederhergestellt.',
  UPDATE_FAILED_DEFAULT: 'Das Update ist fehlgeschlagen.',
  UPDATE_NO_REPORT: 'Das Update wurde nicht abgeschlossen: Der Update-Dienst hat sich nicht zurückgemeldet.',
  UPDATE_INTERRUPTED_BEFORE_HANDOVER:
    'Das Update wurde vor der Übergabe unterbrochen. Die Server wurden wieder gestartet.',
  // ---- network ----
  NETWORK_ADDRESS_MISSING: (p) =>
    `Die Adresse ${p.host} existiert auf diesem Rechner nicht (Netzwerkadapter getrennt oder Adresse geändert). LanQuarry lauscht deshalb auf allen Adaptern (0.0.0.0). Bitte die Einstellung unter System > Netzwerk & Zugriff prüfen.`,
  NETWORK_PORT_FALLBACK: (p) =>
    `Der gespeicherte Port ${p.port} ist bereits belegt. LanQuarry verwendet stattdessen Port ${p.defaultPort} aus der Konfiguration. Bitte die Einstellung unter System > Netzwerk & Zugriff prüfen.`,
  NETWORK_RESTART_AUTOMATIC: 'Der Dienst startet LanQuarry nach dem Beenden selbst neu (dauert etwa 5 bis 15 Sekunden).',
  NETWORK_RESTART_MANUAL:
    'Diese Installation läuft ohne Dienst: LanQuarry beendet sich und muss von Hand neu gestartet werden.',
  // ---- players ----
  PLAYERS_PENDING:
    'Der Server hat die Änderung noch nicht in die Datei geschrieben. Sie wird sichtbar, sobald der Server sie verarbeitet hat.',
  // ---- mod updates ----
  MOD_UPDATE_UNEXPECTED: 'Unerwarteter Fehler beim Aktualisieren.',
  MOD_UPDATE_GONE: 'Der Mod existiert nicht mehr.',
  MOD_UPDATE_BACKUP_KEPT: (p) => `${p.reason} Die ursprüngliche Datei liegt noch im Backup-Ordner (${p.backup}).`,
  // ---- mods: scan, toggle and install warnings ----
  MOD_SCAN_UNREADABLE: (p) => `Die Datei „${p.file}“ konnte nicht gelesen werden und wurde übersprungen.`,
  MOD_SCAN_RENAME_CONFLICT: (p) => `Die Umbenennung in „${p.file}“ konnte nicht übernommen werden (Konflikt in der Datenbank).`,
  MOD_SCAN_ENTRY_REMOVED: (p) => `Der Eintrag für „${p.file}“ wurde entfernt und beim nächsten Scan erneut erfasst.`,
  MOD_SCAN_TWIN_FILES: (p) =>
    `Sowohl „${p.kept}“ als auch „${p.ignored}“ liegen im Ordner (${p.content === 'identical' ? 'identischer' : 'unterschiedlicher'} Inhalt). Die Datei „${p.ignored}“ wird ignoriert; bitte eine der beiden entfernen.`,
  MOD_SCAN_IDENTICAL: (p) => `Die Datei „${p.ignored}“ ist identisch mit „${p.preferred}“ und wird ignoriert.`,
  MOD_SCAN_CONFLICT: (p) =>
    `${p.kind === 'changed' ? 'Geänderte' : 'Neue'} Datei „${p.file}“ konnte nicht übernommen werden (Konflikt in der Datenbank).`,
  MOD_SCAN_MODRINTH_DOWN: 'Modrinth ist nicht erreichbar; unbekannte Dateien bleiben vorerst unerkannt.',
  MOD_SCAN_PROJECT_INSTALLED: (p) =>
    `Die Datei „${p.file}“ gehört zum bereits installierten Projekt „${p.project}“ und bleibt unerkannt.`,
  MOD_DEPENDENCY_ENABLED: (p) => `„${p.name}“ war deaktiviert und wurde als benötigte Abhängigkeit ebenfalls aktiviert.`,
  MOD_DISABLED_ANYWAY: (p) => `„${p.name}“ wird trotzdem deaktiviert, obwohl ${p.dependents} es benötigt.`,
  MOD_REENABLED: (p) => `„${p.name}“ war deaktiviert und wird wieder aktiviert, weil „${p.by}“ es benötigt.`,
  MOD_DEPENDENCY_EXTERNAL: (p) =>
    `Die Abhängigkeit „${p.dependency}“ von „${p.parent}“ wird nicht über Modrinth bereitgestellt und muss manuell bereitgestellt werden.`,
  MOD_DEPENDENCY_VERSION_CLASH: (p) =>
    `Eine Abhängigkeit von „${p.parent}“ fordert eine andere Version von „${p.mod}“; die bereits gewählte Version wird verwendet.`,
  // ---- world import: progress, results and failures ----
  IMPORT_STEP_UPLOAD: 'Archiv wird hochgeladen',
  IMPORT_STEP_CHECK: 'Archiv wird geprüft',
  IMPORT_STEP_ANALYZE: 'Welt wird analysiert',
  IMPORT_STEP_CREATE: 'Server wird angelegt',
  IMPORT_STEP_WORLD: 'Welt wird importiert',
  IMPORT_STEP_MOD_FILES: 'Mod-Dateien werden platziert',
  IMPORT_STEP_WAIT_INSTALL: 'Warten auf die Server-Installation',
  IMPORT_STEP_MOD_INSTALL: (p) => `Mod wird installiert: ${p.name}`,
  IMPORT_STEP_REPLACE: 'Welt wird ersetzt',
  IMPORT_STEP_SAFETY: 'Sicherungskopie der bisherigen Welt wird erstellt',
  IMPORT_STEP_SWAP: 'Neue Welt wird eingesetzt',
  IMPORT_UNEXPECTED: 'Der Import ist aus einem unerwarteten Grund fehlgeschlagen.',
  IMPORT_FAILED_GENERIC: 'Der Import ist fehlgeschlagen.',
  IMPORT_PARTIAL: (p) =>
    `Der Server „${p.name}“ wurde angelegt, die Welt konnte aber nicht vollständig importiert werden: ${p.reason} Die Welt lässt sich über „Welt ersetzen“ erneut importieren.`,
  IMPORT_ANNOUNCE_REPLACING: 'Die Welt wird durch einen Import ersetzt ...',
  IMPORT_ANNOUNCE_REPLACED: 'Die Welt wurde durch den Import ersetzt.',
  IMPORT_ANNOUNCE_FAILED: (p) => `Der Welt-Import ist fehlgeschlagen, die bisherige Welt bleibt erhalten: ${p.reason}`,
  IMPORT_WARN_SINGLEPLAYER: 'Der Einzelspieler-Spielstand wurde als Spielerdaten des Servers übernommen.',
  IMPORT_WARN_ITEM: (p) => `„${p.item}“ konnte nicht übernommen werden.`,
  IMPORT_WARN_PROPERTIES: 'server.properties konnte nicht übernommen werden.',
  IMPORT_WARN_MODLIST: 'Die Mod-Liste konnte nicht gelesen werden.',
  IMPORT_WARN_MODLIST_REASON: (p) => `Die Mod-Liste konnte nicht gelesen werden: ${p.reason}`,
  IMPORT_MOD_FILE_FAILED: 'Die Datei konnte nicht gespeichert werden.',
  IMPORT_MOD_INSTALL_FAILED: 'Die Installation ist fehlgeschlagen.',
  // ---- world import: notices ----
  WORLD_PRE_1_9_UPLOAD:
    'Diese Welt ist älter als Minecraft 1.9 (keine Versionsangabe in level.dat). Bitte die Minecraft-Version selbst wählen.',
  WORLD_PRE_1_9:
    'Diese Welt ist älter als Minecraft 1.9 (level.dat enthält keine Versionsangabe). Bitte die passende Minecraft-Version selbst wählen. Beim ersten Start wird die Welt in das gewählte Format umgewandelt; das lässt sich nicht rückgängig machen.',
  VERSION_APPROX: (p) => `Die Version wurde aus der Datenversion ${p.dataVersion} auf Minecraft ${p.mcVersion} geschätzt.`,
  JARS_UNREADABLE: (p) => `Diese Dateien sind keine lesbaren Jar-Dateien: ${p.names}.`,
  OTHER_WORLDS_UPLOAD: (p) => `Weitere Welten im Archiv werden nicht übernommen: ${listOf(p)}.`,
  LOADER_VERSION_UNAVAILABLE: (p) =>
    `Die Loader-Version für Minecraft ${p.mcVersion} konnte nicht ermittelt werden (${p.reason}). Bitte Loader und Version selbst wählen.`,
  WORLD_NEWER: (p) =>
    `Die Welt wurde zuletzt mit ${worldOf(p)} gespeichert und ist daher neuer als die gewählte Version ${p.target}. Eine Welt auf eine ältere Version zurückzusetzen beschädigt sie. Bitte mindestens ${p.minimum === '' ? 'die Version der Welt' : p.minimum} wählen.`,
  WORLD_UPGRADE: (p) =>
    `Die Welt stammt aus ${worldOf(p)} und wird beim ersten Start auf ${p.target} umgewandelt. Das funktioniert nur in eine Richtung: danach lässt sie sich mit der alten Version nicht mehr öffnen. Vorher unbedingt eine Sicherung der Quelle aufbewahren.`,
  WORLD_PATCH_UPGRADE: (p) => `Die Welt stammt aus ${worldOf(p)} und wird beim Start auf ${p.target} aktualisiert.`,
  WORLD_VERSION_UNKNOWN:
    'Die Minecraft-Version der Welt konnte nicht bestimmt werden. Wird eine zu alte Version gewählt, kann die Welt beschädigt werden.',
  MODDED_NO_LOADER: (p) =>
    `Die Welt enthält Inhalte von Mods, ${p.loader} kann sie aber nicht laden. Modifizierte Blöcke, Gegenstände und Wesen gehen verloren.`,
  MODDED_PAPER: 'Paper lädt keine Mods, nur Plugins. Modifizierte Blöcke, Gegenstände und Wesen der Welt gehen verloren.',
  LOADER_SWITCH: (p) =>
    `Die Welt gehört zu ${p.from}, gewählt ist aber ${p.to}. Mods sind zwischen Mod-Loadern nicht austauschbar; Mod-Inhalte können verloren gehen oder die Welt lässt sich nicht laden.`,
  LAYOUT_CONVERTED: (p) =>
    p.style === 'split'
      ? 'Nether und End werden für Paper in eigene Ordner (_nether, _the_end) verschoben.'
      : 'Nether und End werden aus den Paper-Ordnern in den Weltordner verschoben (DIM-1, DIM1).',
  LAYOUT_UNIFIED: 'Die Welt verwendet das neue Ordnerformat mit „dimensions“ und wird unverändert übernommen.',
  OTHER_WORLDS: (p) => `Das Archiv enthält weitere Welten, die nicht übernommen werden: ${listOf(p)}.`,
  SINGLEPLAYER_PLAYER:
    'Der Einzelspieler-Spielstand (Inventar, Position) wird für den Server übernommen. Er gilt für den Spieler mit derselben Mojang-Konto-ID, daher sollte der Server im Online-Modus laufen.',
  REPLACE_ONE_WAY:
    'Die jetzige Welt wird durch die importierte ersetzt. Vorher wird automatisch eine Sicherungskopie angelegt.',
  MODS_MISSING: (p) =>
    `Diese Mods der Welt werden nicht bereitgestellt: ${listOf(p)}. Startet der Server ohne sie, können Blöcke und Gegenstände der Mods aus der Welt verschwinden.`,
  // ---- world import: loader evidence ----
  LOADER_EVIDENCE_EXPORT: (p) => (p.version === '' ? `Die Exportdatei nennt ${p.loader}.` : `Die Exportdatei nennt ${p.loader} ${p.version}.`),
  LOADER_EVIDENCE_FILES: (p) => `${p.count} Datei(en) im Archiv gehören zu ${p.loader}.`,
  LOADER_EVIDENCE_NEOFORGE_LIST: 'level.dat enthält eine NeoForge-Modliste.',
  LOADER_EVIDENCE_FORGE_LIST: 'level.dat enthält eine Forge-Modliste.',
  LOADER_EVIDENCE_FML: 'level.dat enthält einen Forge-Abschnitt (FML).',
  LOADER_EVIDENCE_BRAND: (p) => `level.dat nennt die Server-Marke „${p.brand}“.`,
  LOADER_EVIDENCE_PAPER_HINTS: (p) => `Hinweis auf Bukkit/Paper: ${p.hints}.`,
  LOADER_EVIDENCE_NONE: 'Kein Hinweis auf Mods oder Plugins gefunden.',
  // ---- world export ----
  EXPORT_UNEXPECTED: 'Der Export ist aus einem unerwarteten Grund fehlgeschlagen.',
  EXPORT_FAILED_REASON: (p) => `Export fehlgeschlagen: ${p.reason}`,
  EXPORT_ANNOUNCE: 'Die Welt wird exportiert ...',
  EXPORT_FINISHED: 'Welt-Export abgeschlossen.',
  EXPORT_WARN_SYMLINKS: (p) => `${p.count} Symlink(s) wurden nicht exportiert.`,
  // ---- backups ----
  BACKUP_ANNOUNCE_SAFETY: 'Sicherungskopie der Welt wird erstellt ...',
  BACKUP_ANNOUNCE: 'Backup der Welt wird erstellt ...',
  BACKUP_FINISHED: 'Welt-Backup abgeschlossen.',
  BACKUP_FAILED_REASON: (p) => `Backup fehlgeschlagen: ${p.reason}`,
  BACKUP_UNEXPECTED: 'Das Backup ist aus einem unerwarteten Grund fehlgeschlagen.',
  BACKUP_INTERRUPTED_SHUTDOWN: 'Das Backup wurde unterbrochen (die Anwendung wurde beendet).',
  BACKUP_NOTE_SYMLINKS: (p) => `${p.count} Symlink(s) wurden nicht gesichert.`,
  SAVE_ON_UNCONFIRMED:
    'Der Server hat das automatische Speichern nicht bestätigt. Bitte prüfen, ob das automatische Speichern wieder aktiv ist.',
  BACKUP_NOTE_BEFORE_RESTORE: (p) => `Automatisch erstellt vor der Wiederherstellung von ${p.fileName}.`,
  BACKUP_NOTE_BEFORE_IMPORT: 'Automatisch erstellt, bevor die Welt durch einen Import ersetzt wurde.',
  BACKUP_RESTORING: 'Backup wird wiederhergestellt ...',
  BACKUP_RESTORED: 'Backup wiederhergestellt.',
  RESTORE_FAILED_REASON: (p) => `Wiederherstellung fehlgeschlagen, die bisherige Welt bleibt erhalten: ${p.reason}`,
  UNEXPECTED_ERROR: 'unerwarteter Fehler',
  RESTORE_LEVEL_MISMATCH: (p) =>
    `Die wiederhergestellte Welt heißt „${p.restored}“, der Server verwendet aber „${p.current}“ (level-name in der server.properties). Bitte den Weltnamen anpassen oder ein Backup mit der Konfiguration verwenden.`,
  // ---- server installation ----
  INSTALL_INTERRUPTED_SHUTDOWN: 'Die Installation wurde unterbrochen (die Anwendung wurde beendet).',
  INSTALL_UNEXPECTED_ERROR: 'Während der Installation ist ein unerwarteter Fehler aufgetreten.',
  INSTALL_STEP_RESOLVE: 'Version wird ermittelt',
  INSTALL_STEP_DOWNLOAD: (p) => `${p.fileName}: ${p.kib} KiB`,
  INSTALL_STEP_INSTALLER: 'Installer läuft',
  INSTALL_DONE: 'Installation abgeschlossen',
  // ---- managed Java runtimes ----
  JAVA_ORIGIN_MANAGED: (p) =>
    `Von LanQuarry am ${p.date} automatisch installiert: Eclipse Temurin ${p.version} (${p.image}), von api.adoptium.net geladen, SHA-256 ${p.sha} geprüft. Liegt im Datenordner und ist nicht im System, im PATH oder in der Registry eingetragen.`,
  JAVA_STEP_METADATA: (p) => `Java ${p.major} wird bei Adoptium abgefragt ...`,
  JAVA_STEP_DOWNLOAD: (p) => `Java ${p.major} wird heruntergeladen (${p.receivedMb} von ${p.totalMb} MB)`,
  JAVA_STEP_VERIFY: (p) => `Prüfsumme (SHA-256) von Java ${p.major} stimmt überein`,
  JAVA_STEP_EXTRACT: (p) => `Java ${p.major} wird entpackt ...`,
  JAVA_STEP_CHECK: (p) => `Java ${p.major} wird geprüft ...`,
  JAVA_INSTALLED: (p) => `Java ${p.major} ist installiert.`,
  JAVA_INSTALL_FAILED: (p) => `Java ${p.major} konnte nicht installiert werden.`,
  AUTOSTART_SKIPPED: (p) =>
    `Autostart von „${p.name}“ übersprungen: ${p.reason === 'eula' ? 'EULA nicht akzeptiert' : 'nicht installiert'}`,
  AUTOSTART_FAILED_NAMED: (p) => `Autostart von „${p.name}“ fehlgeschlagen: ${p.reason}`,
  AUTOSTART_FAILED: (p) => `Autostart fehlgeschlagen: ${p.reason}`,
  START_LABEL_FAILED: (p) => `${p.label} fehlgeschlagen: ${p.reason}`,
  START_AFTER_RESTART: 'Start nach dem Neustart',
  START_AFTER_UPDATE_FAILED: (p) => `Start nach dem Update fehlgeschlagen: ${p.reason}`,
};

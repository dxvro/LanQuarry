# LocalMC CraftManager

> **Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.**
> NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

Verwaltet mehrere Minecraft-Server-Instanzen auf einem Host und wird im lokalen Netzwerk (LAN) über den Browser bedient.

> **Sicherheitshinweis:** Die API kann Prozesse starten und Konsolenbefehle ausführen. Ohne `AUTH_TOKEN` (Standard, damit der Zugriff im LAN offen bleibt) hat **jeder**, der den Port erreichen kann, vollen Zugriff, und beim Start erscheint eine Warnung im Log. Nur in vertrauenswürdigen Netzwerken betreiben, niemals ins Internet freigeben. Für eine Anmeldung `AUTH_TOKEN` setzen (siehe unten) oder in der Weboberfläche unter **System** ein Passwort festlegen.

Stand: **Phase 5** (Datenbank, Basis-Webserver, Modrinth-Mod-Verwaltung, Server-Installer, Prozessverwaltung, Live-Konsole per WebSocket, `server.properties`-Editor, Server-API, optionales Zugriffstoken, die Weboberfläche in React sowie automatische Java-Installation, Mods an- und ausschalten, Welt-Backups mit Zeitplan, Installationsprotokoll, Aufräumen der Update-Backups und Autostart von Servern) sowie **Phase 6**: Installationspakete für Windows (Installer mit Dienst) und Linux (systemd), siehe [Installation auf einem anderen Rechner / einer VM](#installation-auf-einem-anderen-rechner--einer-vm).

## Voraussetzungen

- Node.js 22 oder neuer (getestet mit 26) und npm
- **Java** für den Betrieb der Minecraft-Server. Fehlt die passende Version, installiert CraftManager sie selbst (Eclipse Temurin, siehe [Automatische Java-Installation](#automatische-java-installation)); mit `JAVA_AUTO_INSTALL=false` entfällt das und eine vorhandene Installation ist nötig. Welche Version ein Server braucht, steht in der Server-Antwort (`requiredJavaMajor`), z. B. Java 21 für Minecraft 1.21.1 und Java 25 für 26.x.
- Keine nativen Build-Tools nötig (SQLite läuft über `@libsql/client` mit vorkompilierten Binaries)

## Installation aus dem Quellcode

```
npm install
```

## Entwicklung

```
npm run dev          # Backend (tsx watch, Port 3000) und Vite-Entwicklungsserver (Port 5173) gemeinsam
npm run typecheck    # TypeScript-Prüfung von Backend und Frontend inkl. Tests
npm test             # Tests von Backend und Frontend (vitest, ohne Netzwerk und ohne Java)
npm run db:generate  # neue Migration aus src/db/schema.ts erzeugen
```

Während der Entwicklung die Oberfläche unter `http://localhost:5173` öffnen. Der Vite-Server leitet `/api` samt WebSockets an das Backend weiter (`BACKEND_PORT`, Standard 3000) und lässt Host und Origin des Browsers unverändert; deshalb besteht die Host- und Origin-Prüfung des Backends ohne zusätzliche Einstellung. Über die LAN-Adresse erreichbar wird der Entwicklungsserver mit `FRONTEND_HOST=0.0.0.0`. Das Frontend liegt in `packages/frontend` (Vite, React, TypeScript, Tailwind CSS) und bindet die API-Typen des Backends nur als Typen ein (`import type` aus `@craftmanager/backend/contract`), sodass Änderungen an der API beim Typecheck auffallen.

Migrationen liegen in `packages/backend/drizzle/` und werden beim Start automatisch ausgeführt. Bereits angewendete Migrationen werden nie verändert.

## Build und Start

```
npm run build   # baut zuerst das Frontend (packages/frontend/dist), dann das Backend
npm start       # Backend und Weboberfläche auf einem Port
```

Danach ist die Oberfläche unter `http://localhost:3000` erreichbar. Das Backend liefert das gebaute Frontend selbst aus (`FRONTEND_DIR`, Standard `packages/frontend/dist`). Fehlt der Build, läuft die API trotzdem, und `/` zeigt einen Hinweis, `npm run build` auszuführen. Alle Pfade unterhalb von `/api` bleiben JSON-Schnittstelle (auch unbekannte, mit `404 NOT_FOUND`); jede andere Adresse ohne Dateiendung liefert die Oberfläche, damit direkte Links wie `/servers/<ID>/mods` funktionieren.

Prüfung: `http://localhost:3000/api/health`

Beenden mit Strg+C (bzw. `SIGINT`/`SIGTERM`/`SIGBREAK`/`SIGHUP`): Zuerst werden alle laufenden Minecraft-Server mit `stop` sauber gestoppt (Weltdaten werden gespeichert), erst nach Ablauf der Wartezeit werden übrig gebliebene Prozesse hart beendet. Danach schließen Webserver und Datenbank. Ein zweites Strg+C während des Herunterfahrens wird bewusst ignoriert.

## Konfiguration

Optional über Umgebungsvariablen oder eine Konfigurationsdatei (Vorlage: `.env.example`). Echte Umgebungsvariablen haben Vorrang vor der Datei. Die Datei heißt standardmäßig `.env` im Projektstamm und lässt sich mit der Umgebungsvariable `CONFIG_FILE` an einen beliebigen Ort legen. Nennt man `CONFIG_FILE`, muss die Datei existieren (sonst bricht der Start mit einer Meldung ab), und relative Pfade in der Datei gelten dann relativ zu ihr; ohne `CONFIG_FILE` ist eine fehlende Datei normal.

| Variable               | Standard                         | Bedeutung                                                                                 |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `HOST`                 | `0.0.0.0`                        | Adresse, an die der Server bindet. Eine Einstellung unter **System > Netzwerk & Zugriff** hat Vorrang (siehe [Zugriff im Heimnetz](#zugriff-im-heimnetz)) |
| `PORT`                 | `3000`                           | HTTP-Port, ebenfalls in der Weboberfläche änderbar                                         |
| `CONFIG_FILE`          | `<Projekt>/.env`                 | Pfad der Konfigurationsdatei (nur als echte Umgebungsvariable, nicht in der Datei selbst) |
| `DATA_DIR`             | `<Projekt>/data`                 | Datenbank, Java-Laufzeiten (`runtimes/`) und Backups (`backups/`)                          |
| `SERVERS_DIR`          | `<Projekt>/servers`              | Ordner der Minecraft-Server-Instanzen (`<SERVERS_DIR>/<Server-ID>/`)                      |
| `LOG_LEVEL`            | `info`                           | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                              |
| `MODRINTH_USER_AGENT`  | `LocalMC-CraftManager/<Version>` | User-Agent für Modrinth- und Loader-Anfragen (keine persönlichen Daten eintragen)        |
| `AUTH_TOKEN`           | (leer = keine Anmeldung)         | Zugriffstoken, mindestens 8 Zeichen. Aktiviert die Anmeldung für die gesamte API. Zugleich das erste Passwort der Weboberfläche und der Maschinen-Zugang (`Authorization: Bearer`) für Skripte und den Update-Dienst, siehe [Passwort](#passwort-der-weboberfläche) |
| `ALLOWED_ORIGINS`      | (leer)                           | Kommagetrennte zusätzliche Origins (der Vite-Dev-Proxy braucht keinen Eintrag) |
| `ALLOWED_HOSTS`        | (leer)                           | Kommagetrennte zusätzliche Host-Namen ohne Port, z. B. `craft.example.lan` (siehe Sicherheit). In der Weboberfläche lassen sich weitere ergänzen |
| `FRONTEND_DIR`         | `<Code>/../frontend/dist`        | Ordner mit der gebauten Weboberfläche                                                     |
| `JAVA_AUTO_INSTALL`    | `true`                           | Fehlende Java-Version automatisch installieren (`true`/`false`, auch `1`/`0`, `ja`/`nein`) |
| `MOD_BACKUP_KEEP`      | `3`                              | Backups pro Mod in `mods_backup/` bzw. `plugins_backup/`, die nach Updates bleiben (1 bis 100) |
| `UPDATE_CHECK`         | `true`                           | Nach neuen Releases suchen (`false` schaltet Prüfung und Update ganz ab, siehe [Updates](#updates)) |
| `UPDATE_REPO`          | `dxvro/LocalMC-CraftManager`     | GitHub-Repository (`Besitzer/Name`), dessen Releases geprüft werden                       |
| `UPDATE_CHANNEL`       | `stable`                         | `stable` oder `prerelease` (dann auch Vorabversionen wie `1.0.0-rc.1`)                    |
| `UPDATE_COUNTDOWN_SECONDS` | `60`                         | Countdown vor dem Stoppen der Server bei einem Update (0 bis 600)                         |
| `IMPORT_MAX_MB`        | `4096`                           | Größte erlaubte Archivdatei beim Welt-Import in MB (16 bis 1048576); entpackt ist höchstens das Vierfache erlaubt |
| `STOP_TIMEOUT_SECONDS` | `120`                            | Wartezeit nach `stop`, bevor ein Server hart beendet wird (5 bis 3600); bei großen Welten nicht zu knapp wählen, sonst können beim Speichern Daten verloren gehen |

Nur für die Entwicklung (Vite): `FRONTEND_PORT` (Standard 5173), `FRONTEND_HOST` (Standard `localhost`) und `BACKEND_PORT` (Standard `PORT`, sonst 3000).

Die Ordner `data/` und `servers/` werden beim Start angelegt und sind nicht Teil des Repositories.

### Betrieb ohne Projektordner

Die Anwendung setzt kein Repository voraus. Migrationen (`drizzle/`) liegen im Codeordner und werden relativ dazu gefunden, die Weboberfläche standardmäßig als `<Backend>/../frontend/dist`, beides unabhängig vom Arbeitsverzeichnis. Läuft der Code nicht aus einem Checkout (`<Projekt>/packages/backend`), liegen Daten und Server standardmäßig in einem Benutzerordner (Windows `%LOCALAPPDATA%\LocalMC-CraftManager`, macOS `~/Library/Application Support/LocalMC-CraftManager`, Linux `$XDG_DATA_HOME/localmc-craftmanager` bzw. `~/.local/share/localmc-craftmanager`). `DATA_DIR`, `SERVERS_DIR`, `FRONTEND_DIR` und `CONFIG_FILE` überschreiben das jeweils vollständig; eine `.env` im Projekt ist nicht nötig. Beim Start steht im Log, welche Konfigurationsdatei und welche Ordner verwendet werden. Die fertigen Installationspakete (Windows-Dienst, Linux-systemd) nutzen genau diesen Mechanismus mit `CONFIG_FILE`; siehe [Installation auf einem anderen Rechner / einer VM](#installation-auf-einem-anderen-rechner--einer-vm).

## Zugriff im Heimnetz

Beim Start nennt CraftManager die Adressen im Protokoll, z. B.:

```
Weboberfläche erreichbar unter: http://192.168.178.20:3000 (Rechnername: http://MCPC:3000; VPN/virtuell: http://172.28.16.1:3000 [vEthernet (WSL (Hyper-V firewall))])
```

Dieselben Adressen stehen unter **System > Netzwerk & Zugriff**, am Ende der Installation (Windows-Installer, `install.sh`), in `Zugangsdaten.txt` und in `GET /api/health` (`lanUrls`, nur mit Anmeldung). Gezeigt werden nur IPv4-Adressen von echten Netzwerkadaptern, private Bereiche (192.168/16, 10/8, 172.16/12) zuerst, ohne Loopback und ohne Link-Local-Adressen (169.254/16). Adapter von WSL, Hyper-V, Docker, VirtualBox, VMware, Tailscale, ZeroTier, WireGuard und anderen VPNs erscheinen getrennt als „VPN/virtuell“, damit die Adresse für die Geräte im Heimnetz die erste ist. Bindet CraftManager an eine einzelne Adresse, wird nur diese genannt; bei `127.0.0.1` nur „dieser Rechner“.

**Einstellungen in der Weboberfläche** (System > Netzwerk & Zugriff, in der Datenbank gespeichert, Vorrang vor `HOST`, `PORT` und `ALLOWED_HOSTS` der Konfigurationsdatei, die weiter als Rückfall dient):

| Einstellung | Bedeutung |
| --- | --- |
| Lauschen auf | alle Netzwerkadapter (`0.0.0.0`), eine der erkannten Adressen dieses Rechners oder `127.0.0.1` (nur dieser Rechner). Eine Adresse, die dem Rechner nicht gehört, wird abgelehnt. |
| Web-Port | 1 bis 65535; muss frei sein (echter Bind-Test wie beim Start eines Minecraft-Servers) und darf keinem Minecraft-Server gehören. Der Port, auf dem CraftManager gerade lauscht, zählt nicht als belegt. |
| Weitere erlaubte Rechnernamen | z. B. `minecraft.fritz.box`; erweitert die Host-Prüfung (siehe [Sicherheit](#sicherheit)) zusätzlich zu `ALLOWED_HOSTS`. |
| Öffentliche Adresse | optional, wird allen als Adresse angezeigt (`minecraft.fritz.box:3000` oder eine volle `http://`-Adresse); ihr Rechnername wird automatisch erlaubt. |

Änderungen gelten erst nach einem Neustart. **Jetzt neu starten** zeigt vorher die neue Adresse, stoppt alle laufenden Minecraft-Server mit der normalen Stopp-Logik (Welt wird gespeichert), merkt sich, welche liefen, beendet CraftManager mit dem Exit-Code 75 und startet die Server nach dem Neustart wieder. Der Browser wechselt von selbst zur neuen Adresse, sobald sie antwortet. Wer startet CraftManager danach neu?

| Installation | Neustart nach Exit-Code 75 |
| --- | --- |
| Linux (systemd) | automatisch: `Restart=on-failure` (und `RestartForceExitStatus=75`), nach etwa 5 Sekunden |
| Windows-Dienst (WinSW) | automatisch: Wiederherstellungsaktion „Neu starten“ (`onfailure`), nach 10 bis 60 Sekunden |
| Portables ZIP | `start-portable.cmd` startet bei Code 75 selbst neu |
| Quellcode (`npm start`, `npm run dev`) | von Hand wieder starten; die Oberfläche weist darauf hin |

**Sicherheitsnetz gegen Aussperren:** Existiert die gespeicherte Adresse beim Start nicht (Adapter getrennt, Adresse vom Router geändert), lauscht CraftManager stattdessen auf `0.0.0.0`, schreibt eine Warnung ins Protokoll und zeigt sie als Hinweis auf der Systemseite. Ist der gespeicherte Port belegt, nimmt CraftManager den Port aus der Konfigurationsdatei. Nur wenn auch der belegt ist, bricht der Start mit der bekannten Meldung ab. Die tatsächlich benutzte Adresse steht in `<DATA_DIR>/network.json`; Installer und Update-Dienst prüfen dort, ob die Anwendung antwortet.

**Feste Adresse:** Damit sich die IP-Adresse des Rechners nicht ändert, im Router eine feste Adresse vergeben (DHCP-Reservierung). FritzBox: **Heimnetz > Netzwerk >** Gerät in der Liste **bearbeiten** und **„Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“** aktivieren. Alternativ im Router einen Namen wie `minecraft.fritz.box` nutzen und ihn in der Oberfläche unter „Weitere erlaubte Rechnernamen“ eintragen.

**Firewall:** Falls andere Geräte die Seite nicht erreichen, blockiert vermutlich die Firewall den Web-Port. Unter Windows (Administrator-PowerShell, Port ggf. anpassen):

```
New-NetFirewallRule -DisplayName "LocalMC CraftManager" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

Unter Linux mit ufw `sudo ufw allow 3000/tcp`, mit firewalld `sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload`. Wird der Web-Port in der Oberfläche geändert, muss die Regel für den neuen Port angelegt werden; die Regel des Windows-Installers („LocalMC CraftManager - Web“) richtet das Installationsprogramm bei einem erneuten Lauf (auch beim Update) auf den aktuellen Port aus. Für die Minecraft-Server selbst muss der jeweilige Server-Port (Standard 25565) ebenfalls freigegeben werden.

Ist der Port beim Start bereits belegt (und kein Rückfall möglich), bricht der Start mit einer Meldung ab. Dann `PORT` in der `.env` ändern.

## Passwort der Weboberfläche

Mit `AUTH_TOKEN` gibt es eine Anmeldung. Das Token aus der Konfiguration (vom Installer zufällig erzeugt) ist das **erste Passwort**. Unter **System > Passwort** lässt sich ein eigenes festlegen (mindestens 10 Zeichen, Stärke-Anzeige):

- **Gespeichert** wird nur ein scrypt-Hash (N=2^15, r=8, p=1, zufälliges Salz je Passwort, Vergleich mit `timingSafeEqual`) in der Datenbank (`app_settings`), nie das Passwort selbst.
- **Gilt für die Anmeldung im Browser.** Ist ein Passwort gesetzt, öffnet nur dieses die Weboberfläche, nicht mehr das Token.
- **Das Token (`AUTH_TOKEN`) bleibt der Maschinen-Zugang** für Skripte und die API (`Authorization: Bearer <Token>`), auch für den Update-Dienst (Gesundheitsprüfung) und die CI-Tests. Eine Passwortänderung berührt ihn nicht; er ändert sich nur in der Konfigurationsdatei. Das Passwort selbst ist kein Bearer-Token.
- **Ändern** verlangt das aktuelle Passwort (vor der ersten Änderung das Token); falsche Eingaben zählen wie falsche Anmeldungen (5 in 5 Minuten, dann `429`, je IP-Adresse). Danach sind **alle anderen Sitzungen ungültig** (der Sitzungswert folgt dem Passwort) und offene WebSockets werden getrennt; der Browser, der geändert hat, erhält ein neues Cookie und bleibt angemeldet.
- **Ohne `AUTH_TOKEN` und ohne Passwort** bleibt der Zugriff offen, wie dokumentiert. Die Systemseite warnt dann und lässt ein Passwort festlegen; danach ist die Anmeldung aktiv.
- **Vergessen?** Nur am Rechner selbst, nie über das Netzwerk: Linux `sudo craftmanager reset-password`, Windows Startmenü **Passwort zurücksetzen** (fordert Administratorrechte an), allgemein `node app/backend/dist/cli.js reset-password` mit den Rechten des Dienstes. Der Befehl schreibt ein neues Zufallspasswort in die Datenbank und zeigt es an (`--password-stdin` liest ein eigenes aus der Standardeingabe). Der laufende Dienst muss dafür nicht gestoppt werden: Er liest den Hash bei jeder Anmeldung und mindestens einmal pro Sekunde neu, alle alten Sitzungen enden damit sofort.

## Installation auf einem anderen Rechner / einer VM

English step-by-step guide: [docs/INSTALL.md](docs/INSTALL.md)

Fertige Pakete (ohne Git, ohne npm, ohne Node.js und ohne Java auf dem Zielrechner) gibt es für **Windows x64**, **Linux x64** und **Linux arm64**. Sie stehen auf der Seite „Releases“ des Projekts auf GitHub:

| Datei                                    | Für                                                        |
| ---------------------------------------- | ---------------------------------------------------------- |
| `craftmanager-<Version>-setup.exe`       | Windows 10/11 und Windows Server 2016 oder neuer (x64), als Dienst |
| `craftmanager-<Version>-win-x64.zip`     | Windows ohne Installation und ohne Dienst (portabel)       |
| `craftmanager-<Version>-linux-x64.tar.gz`   | Linux mit systemd, Intel/AMD 64 Bit                     |
| `craftmanager-<Version>-linux-arm64.tar.gz` | Linux mit systemd, ARM 64 Bit (z. B. Raspberry Pi 4/5 mit 64-Bit-System, Ampere/Graviton-VMs) |
| `SHA256SUMS.txt`                         | Prüfsummen aller Dateien (`sha256sum -c` bzw. `Get-FileHash`) |

In jedem Paket steckt die offizielle Node.js-LTS-Laufzeit (nur die Programmdatei, geprüft gegen `SHASUMS256.txt` von nodejs.org), die gebaute Anwendung mit ihren Produktionsabhängigkeiten, die passende native SQLite-Bibliothek (libsql) für das Zielsystem sowie `LICENSE.txt` und `THIRD-PARTY-NOTICES.txt`. **Java muss nicht installiert werden:** Fehlt die passende Version, lädt CraftManager sie beim ersten Bedarf selbst (Eclipse Temurin, siehe [Automatische Java-Installation](#automatische-java-installation)) in den Datenordner. Der Rechner braucht dafür Internetzugang zu `adoptium.net` und `github.com`, ebenso für Minecraft-Server-Downloads und Modrinth.

### Windows

1. `craftmanager-<Version>-setup.exe` herunterladen und doppelklicken. Die Datei ist **nicht signiert**, deshalb zeigt Windows SmartScreen die Meldung „Der Computer wurde durch Windows geschützt“. Auf **Weitere Informationen** und dann **Trotzdem ausführen** klicken. Wer der Quelle nicht sicher ist, vergleicht vorher die Prüfsumme mit `SHA256SUMS.txt`: `Get-FileHash .\craftmanager-0.3.0-setup.exe`. Eine Administratorbestätigung (UAC) ist nötig, weil ein Dienst eingerichtet wird.
2. Optionale Aufgaben im Installationsprogramm:
   - **Windows-Firewall:** legt zwei Regeln nur für **private** Netzwerke an: Web-Port (TCP 3000 bzw. der in der Konfiguration eingestellte Port) und Minecraft-Ports (TCP 25565-25575). Ohne diese Aufgabe erreichen andere Geräte im Netzwerk den Rechner nicht, solange die Firewall aktiv ist.
   - **Startmenü-Verknüpfung**, die die Weboberfläche im Browser öffnet.
3. Am Ende zeigt das Installationsprogramm die **Adresse** (`http://<Rechnername>:3000`) und das **Zugriffstoken**. Beides steht auch in `C:\ProgramData\LocalMC CraftManager\Zugangsdaten.txt` (nur Administratoren können sie lesen; nach dem Notieren darf sie gelöscht werden) und das Token zusätzlich in der Konfigurationsdatei. Bei einer stillen Installation (`/VERYSILENT`) wird nichts angezeigt, dann liegt die Datei `Zugangsdaten.txt` bereit.
4. Die Weboberfläche im Browser öffnen und mit dem Token anmelden. Es ist zugleich das erste Passwort; ein eigenes lässt sich unter **System** festlegen ([Passwort](#passwort-der-weboberfläche)). Das Startmenü enthält **Passwort zurücksetzen**. Der Dialog des Installers beginnt und endet mit dem Hinweis „Kein offizielles Minecraft-Produkt …“; die Abschlussseite nennt alle Adressen im Heimnetz.

**Wo liegt was?**

| Was                                          | Ort                                                           |
| -------------------------------------------- | ------------------------------------------------------------- |
| Programm (Node, Anwendung, Dienst-Wrapper)   | `C:\Program Files\LocalMC CraftManager`                       |
| Konfiguration (Token, Port, Pfade)           | `C:\ProgramData\LocalMC CraftManager\craftmanager.env`        |
| Datenbank, Java-Laufzeiten, Backups          | `C:\ProgramData\LocalMC CraftManager\data`                    |
| Minecraft-Server                             | `C:\ProgramData\LocalMC CraftManager\servers`                 |
| Protokolle des Dienstes                      | `C:\ProgramData\LocalMC CraftManager\logs`                    |

**Dienst:** Der Windows-Dienst heißt `craftmanager` („LocalMC CraftManager“) und startet automatisch mit Windows. Verwalten über `services.msc` oder in einer Administrator-PowerShell mit `Restart-Service craftmanager`, `Stop-Service craftmanager`, `Start-Service craftmanager`. Konfigurationsänderungen (z. B. `PORT`) werden erst nach einem Neustart des Dienstes wirksam.

**Dienstkonto:** Der Dienst läuft nicht als `SYSTEM`, sondern unter dem virtuellen Dienstkonto `NT SERVICE\craftmanager`. Es hat kein Kennwort, ist nur für diesen Dienst da und darf nur den Datenordner unter `C:\ProgramData\LocalMC CraftManager` ändern; die Programmdateien kann es lesen, aber nicht verändern. Minecraft-Server (und Mods!) laufen unter demselben Konto und haben damit keine Administratorrechte. Der Datenordner ist nur für `SYSTEM`, Administratoren und das Dienstkonto zugänglich, die Konfigurationsdatei mit dem Token ist für das Dienstkonto nur lesbar. Gewählt wurde das virtuelle Konto statt `LocalService`, weil es nicht mit anderen Diensten geteilt wird und die Rechte genau auf diesen Ordner beschränkt bleiben.

**Sauberes Beenden:** Beim Stoppen des Dienstes (auch beim Update und bei der Deinstallation) sendet der Dienst-Wrapper WinSW zuerst Strg+C an die Anwendung (`stopparentprocessfirst`) und wartet bis zu 180 Sekunden (`stoptimeout`). Die Anwendung stoppt in dieser Zeit alle Minecraft-Server mit `stop` und beendet sich. Erst danach wird hart beendet. Wer `STOP_TIMEOUT_SECONDS` über etwa 160 erhöht, muss auch `<stoptimeout>` in `C:\Program Files\LocalMC CraftManager\craftmanager-service.xml` anheben (und den Dienst neu einrichten, am einfachsten durch erneutes Ausführen des Installationsprogramms). Beim Herunterfahren oder Neustarten von Windows gibt Windows Diensten nur begrenzt Zeit; vor dem Herunterfahren den Dienst deshalb besser selbst beenden, wenn Server mit großen Welten laufen.

**Aktualisieren:** Mit Update-Dienst über die Weboberfläche (siehe [Updates](#updates)). Von Hand: das neue `…-setup.exe` einfach über die vorhandene Installation ausführen. Das Installationsprogramm stoppt den Dienst (die Server werden sauber beendet), ersetzt die Programmdateien, startet den Dienst wieder und lässt Daten, Server und Konfiguration (samt Token) unberührt. Neue Datenbankmigrationen laufen beim Start automatisch.

**Deinstallieren:** „Einstellungen > Apps > LocalMC CraftManager > Deinstallieren“. Dienst, Programmdateien und Firewall-Regeln werden entfernt, der **Datenordner `C:\ProgramData\LocalMC CraftManager` bleibt erhalten** (Server, Welten, Backups, Konfiguration). Eine spätere Neuinstallation findet alles wieder. Zum vollständigen Entfernen den Ordner von Hand löschen.

**Stille Installation:** `craftmanager-0.3.0-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART` (mit `/TASKS="firewall,startmenu"` bzw. `/TASKS=""` für die optionalen Aufgaben; ohne Angabe sind beide an).

**Portabel (ZIP):** Entpacken und `start-portable.cmd` ausführen. Daten und Zugangsdaten liegen dann im Ordner `daten` neben dem Skript, der Server lauscht nur auf `127.0.0.1`. Beenden mit Strg+C. Kein Dienst, kein Start mit Windows.

### Linux (systemd)

Voraussetzungen: eine Linux-Distribution mit **glibc** und **systemd** (z. B. Debian 12, Ubuntu 22.04/24.04, Fedora, RHEL-Derivate; Alpine/musl wird nicht unterstützt) und `root`-Rechte. Es muss weder Java noch Node.js installiert sein.

```
tar -xzf craftmanager-0.3.0-linux-x64.tar.gz
cd craftmanager-0.3.0-linux-x64
sudo ./install.sh                  # Port 3000, Firewall unverändert
sudo ./install.sh --open-firewall  # zusätzlich ufw bzw. firewalld: TCP 3000 und 25565-25575
sudo ./install.sh --port 8080      # anderer Web-Port bei der Erstinstallation
```

`install.sh` legt den Systembenutzer `craftmanager` an (ohne Anmeldung), installiert nach `/opt/craftmanager`, erzeugt bei der Erstinstallation `/etc/craftmanager/craftmanager.env` (Modus 640, `root:craftmanager`) mit einem zufälligen `AUTH_TOKEN`, richtet den Dienst `craftmanager` ein, aktiviert und startet ihn legt den Befehl `craftmanager` an (`/usr/local/bin/craftmanager`, z. B. `sudo craftmanager reset-password`) und gibt am Ende **alle Adressen im Heimnetz und das Token** aus. Das Token lässt sich später anzeigen mit:

```
sudo grep AUTH_TOKEN /etc/craftmanager/craftmanager.env
```

| Was                           | Ort                                         |
| ----------------------------- | ------------------------------------------- |
| Programm                      | `/opt/craftmanager`                         |
| Konfiguration                 | `/etc/craftmanager/craftmanager.env`        |
| Datenbank, Java, Backups      | `/var/lib/craftmanager` (`runtimes/`, `backups/`) |
| Minecraft-Server              | `/var/lib/craftmanager/servers`             |
| Protokoll                     | `journalctl -u craftmanager -f`             |

Verwalten: `systemctl status|restart|stop craftmanager`. Die Einheit ist gehärtet (`NoNewPrivileges`, `ProtectSystem=strict` mit Schreibzugriff nur auf `/var/lib/craftmanager`, `ProtectHome`, `PrivateTmp`, eingeschränkte Adressfamilien und Fähigkeiten), bewusst **ohne** `MemoryDenyWriteExecute` und Systemaufruf-Filter, damit Java läuft. Liegen Server außerhalb von `/var/lib/craftmanager` (`SERVERS_DIR`), muss der Pfad in `ReadWritePaths=` der Einheit (`sudo systemctl edit craftmanager`) ergänzt werden.

**Sauberes Beenden:** systemd sendet beim Stoppen `SIGTERM` nur an die Anwendung (`KillMode=mixed`), die alle Minecraft-Server mit `stop` herunterfährt; erst nach `TimeoutStopSec=180` wird der Rest mit `SIGKILL` beendet. Bei einem höheren `STOP_TIMEOUT_SECONDS` als etwa 160 auch `TimeoutStopSec` per `systemctl edit` erhöhen. Bei Abstürzen startet systemd den Dienst neu (`Restart=on-failure`).

**Aktualisieren:** Mit Update-Dienst über die Weboberfläche (siehe [Updates](#updates)). Von Hand: Neues Archiv entpacken und erneut `sudo ./install.sh` ausführen. Der Dienst wird gestoppt (Server sauber beendet), die Programmdateien werden ausgetauscht, Daten und Konfiguration bleiben, dann startet der Dienst wieder (Migrationen laufen beim Start).

**Deinstallieren:** `sudo /opt/craftmanager/uninstall.sh` entfernt Dienst, Programm und die von `--open-firewall` angelegten Regeln und **behält** `/var/lib/craftmanager` und `/etc/craftmanager`. Mit `--purge` (fragt nach; `--yes` überspringt die Frage) wird auch alles andere gelöscht: Server, Welten, Backups, Konfiguration und der Systembenutzer.

### Ports und Netzwerk

| Port                      | Zweck                                           | Wer muss ihn erreichen            |
| ------------------------- | ----------------------------------------------- | --------------------------------- |
| TCP 3000 (`PORT`)         | Weboberfläche und API                           | Geräte im LAN, die verwalten sollen |
| TCP 25565 (je Server)     | Minecraft-Server; weitere Server brauchen weitere Ports (Vorgabe der Installation: 25565-25575) | Spieler |

- **LAN-Zugriff:** Standardmäßig lauscht CraftManager auf `0.0.0.0` und ist damit im ganzen Netzwerk erreichbar, sobald die Firewall den Port erlaubt. Die Adresse lautet `http://<Rechnername>:3000` oder `http://<IP-Adresse>:3000`; beim Start werden die erreichbaren Adressen im Protokoll genannt. Soll die Oberfläche unter einem eigenen Namen erreichbar sein, den Namen in `ALLOWED_HOSTS` der Konfigurationsdatei eintragen (siehe [Sicherheit](#sicherheit)). Nur lokal: `HOST=127.0.0.1` (oder in der Weboberfläche „Nur dieser Rechner“). Details und Einstellungen: [Zugriff im Heimnetz](#zugriff-im-heimnetz).
- **VM:** Die VM braucht eine Netzwerkbrücke (Bridged) oder Portweiterleitungen des Hypervisors für TCP 3000 und die Minecraft-Ports; im Standardmodus „NAT“ ist sie von außen nicht erreichbar.
- **Spieler aus dem Internet:** Nur die Minecraft-Ports (z. B. TCP 25565) am Router an den Rechner weiterleiten. **Den Web-Port 3000 niemals ins Internet freigeben:** Die Oberfläche ist unverschlüsselt (HTTP) und kann Programme starten. Wer sie von außerhalb nutzen will, nimmt ein VPN.
- Die Anmeldung per Token bzw. Passwort ist die einzige Schutzschicht; deshalb nicht weitergeben. Bei Verdacht das Passwort ändern (System > Passwort), das Token in der Konfigurationsdatei ändern (mindestens 8 Zeichen) und den Dienst neu starten.

### Pakete selbst bauen

```
npm ci
npm run package -- --target win-x64      # oder linux-x64, linux-arm64
```

`scripts/package.mjs` baut bei Bedarf Frontend und Backend (`--skip-build` verwendet den vorhandenen Build), installiert die Produktionsabhängigkeiten des Backends aus `package-lock.json` für das **Zielsystem** (auch bei Cross-Builds; das passende `@libsql/<Plattform>`-Paket wird geprüft, bei Bedarf mit der SHA-512-Integrität aus der Lock-Datei direkt aus der npm-Registry geholt), lädt die aktuelle Node.js-LTS-Laufzeit von nodejs.org (`--node-version vX.Y.Z` legt eine Version fest) und prüft sie gegen `SHASUMS256.txt`, lädt für Windows WinSW 2.12.0 (SHA-256 fest eingetragen in `scripts/lib/pins.mjs`) und schreibt `release/<Ziel>/` samt Archiv `release/craftmanager-<Version>-<Ziel>.(zip|tar.gz)` und `.sha256`. Downloads sind auf `nodejs.org`, `github.com` und `registry.npmjs.org` beschränkt. Auf einem Rechner mit gleichem Zielsystem startet das Skript zum Schluss die mitgelieferte Node-Programmdatei als Probe (libsql und Anwendung laden). Das Windows-Installationsprogramm entsteht aus `release/win-x64` mit Inno Setup 6:

```
ISCC.exe /DAppVersion=0.3.0 installer\windows\craftmanager.iss
```

Die GitHub-Workflows (`.github/workflows/ci.yml` und `release.yml`) prüfen bei jedem Push (Typecheck, Tests, Build, Paketbau, auf Ubuntu zusätzlich eine echte Installation mit `install.sh`) und erzeugen bei einem Tag `v<Version>` alle drei Pakete samt Installer und legen ein GitHub-Release an. Das Tag muss zur Version in `packages/backend/package.json` passen.

## Updates

Installierte Clients aktualisieren sich selbst, wenn der Besitzer ein neues GitHub-Release veröffentlicht. **Nichts wird automatisch installiert:** CraftManager meldet die neue Version samt Versionshinweisen in einem Banner auf jeder Seite, und das Update läuft erst, nachdem ein Administrator in der Oberfläche auf **Jetzt aktualisieren** geklickt und bestätigt hat.

**Ablauf für Administratoren**

1. CraftManager fragt alle 6 Stunden (zufällig um etwa 10 % versetzt), kurz nach dem Start und auf Knopfdruck („Jetzt prüfen“ unter **System**) die Releases von `dxvro/LocalMC-CraftManager` ab. Anfragen gehen nur an `api.github.com`, `github.com` und die Download-Server von GitHub (`release-assets.githubusercontent.com`, `objects.githubusercontent.com`); jede Weiterleitung wird einzeln geprüft. Es werden keine persönlichen Daten gesendet (der User-Agent ist `LocalMC-CraftManager/<Version>`), und das Repository ist öffentlich, es wird also kein Token gebraucht.
2. Das Banner zeigt Version und Versionshinweise (als Text, mit wenigen sicheren Markdown-Elementen: Überschriften, Listen, **fett**, `Code`, https-Links; nie als HTML). Nur streng neuere Versionen zählen; Vorabversionen und Entwürfe werden ignoriert, außer mit `UPDATE_CHANNEL=prerelease`.
3. **Jetzt aktualisieren** öffnet eine Bestätigung: Alle laufenden Minecraft-Server werden gestoppt. Gewählt werden kann der Countdown (Standard 60 s, `UPDATE_COUNTDOWN_SECONDS`).
4. Das Update lädt das Paket für das eigene System, prüft Signatur und Prüfsumme (die Server laufen währenddessen weiter), warnt die Spieler mit `say`-Nachrichten im Chat (bei 60, 30, 10, 5, 4, 3, 2, 1 Sekunden), stoppt die Server mit der normalen Stopp-Logik (Welt wird gespeichert), übergibt an den Update-Dienst, installiert, prüft, ob die neue Version antwortet, und **startet die vorher laufenden Server wieder**. Der Fortschritt (Download, Prüfung, Warten auf Server, Installation, Neustart, Ergebnis) steht im Banner und unter **System**; dort steht auch der Verlauf (Version von/auf, Zeit, Ergebnis). Bis zum Countdown-Ende lässt sich das Update abbrechen.
5. Während des Updates sind Starten, Installieren, Löschen und Ändern von Servern gesperrt (`409 UPDATE_IN_PROGRESS`); Stoppen und Konsolenbefehle bleiben möglich. Ein laufender Server-Install, ein Backup, eine Java-Installation, ein Welt-Export oder ein laufender Welt-Import verhindern den Start des Updates. Während des Updates werden auch neue Welt-Exporte, Uploads, Importe und das Ersetzen einer Welt mit `409 UPDATE_IN_PROGRESS` abgelehnt.
6. Schlägt die Installation fehl oder antwortet die neue Version nicht, stellt der Update-Dienst die bisherige Version wieder her; der Verlauf nennt den Grund, die Server werden wieder gestartet. Vor dem Update wird zusätzlich eine Kopie der Datenbank in `<DATA_DIR>/updates/db-before-update.db` abgelegt (eine neuere Datenbank kann ein Rollback nicht zurückdrehen).

**Wo es funktioniert**

| Installation | Verhalten |
| --- | --- |
| Windows-Installer (`…-setup.exe`) | vollständig: Update-Dienst `craftmanager-updater` (LocalSystem) |
| Linux (`install.sh`) | vollständig: `craftmanager-update.path` und `craftmanager-update.service` (root) |
| Portables ZIP, Quellcode, Installationen ohne Update-Dienst (vor der Update-Funktion) | nur Hinweis mit Link zur Download-Seite, kein Selbst-Update; die Oberfläche erklärt den Grund. Eine vorhandene Installation ohne Update-Dienst wird einmal von Hand auf das neue Paket gehoben, danach geht es von selbst. |

Abschalten: `UPDATE_CHECK=false` in der Konfigurationsdatei (keine Anfragen mehr, kein Banner, Update gesperrt). Nur die Hintergrundprüfung abschalten: Schalter **Automatisch nach Updates suchen** unter **System** (steht in der Datenbank). Eine andere Quelle: `UPDATE_REPO=besitzer/name`.

**Vertrauenskette (Warum das sicher ist)**

Ein Selbst-Update ist Codeausführung aus dem Netz, deshalb gilt:

- **Signierte Releases:** `release.yml` signiert `SHA256SUMS.txt` mit Ed25519 (Node `crypto`, privater Schlüssel im Actions-Secret `UPDATE_SIGNING_KEY`) und lädt `SHA256SUMS.txt.sig` mit hoch. Die öffentlichen Schlüssel stehen im Quelltext (`packages/backend/src/update/keys.ts`). Der Client lädt Paket, Prüfsummen und Signatur, prüft **zuerst die Signatur** (alle Bytes von `SHA256SUMS.txt`), dann den SHA-256 des Pakets, und lehnt bei jeder Abweichung ab. Der Dateiname des Pakets enthält die Version und steht in den signierten Prüfsummen; eine alte, signierte Version lässt sich also nicht als neue ausgeben. Größen- und Zeitlimits gelten, temporäre Dateien liegen in `<DATA_DIR>/updates`.
- **Rechtetrennung:** Die Anwendung läuft ohne Rechte (Windows: `NT SERVICE\craftmanager`, Linux: Benutzer `craftmanager`, `NoNewPrivileges`, `ProtectSystem=strict`) und kann sich nicht selbst installieren. Sie kann ein Update nur **anfordern**: Sie legt das geprüfte Paket und `request.json` (zuletzt, atomar) im Anfrageordner ab (Linux `/var/lib/craftmanager-update/request`, Windows `C:\ProgramData\LocalMC CraftManager Update\request`). Den Statusordner darüber beschreibt nur root bzw. SYSTEM; die Anwendung darf ihn lesen.
- **Der privilegierte Updater** (`tools/updater.mjs`, nur Node-Bordmittel) vertraut nichts aus dem Anfrageordner: Er kopiert die Dateien **einmal** (keine Symlinks, Größenlimit) in einen Ordner, den die Anwendung nicht beschreiben kann (kein TOCTOU), prüft **dort noch einmal** Signatur (mit den Schlüsseln der *installierten* Version, `tools/update-keys.json`) und Hash, leitet Dateinamen und Zielsystem selbst aus der Installation ab, verlangt eine streng neuere Version und vergleicht die Version im entpackten Paket. Dann sichert er die bisherige Version, installiert, prüft `/api/health` auf die neue Version und rollt bei Fehlern zurück.
- **Linux:** Der root-Updater wird von systemd (`.path`-Einheit) gestartet und läuft in einer eigenen Einheit ohne Bindung an `craftmanager.service`; das Stoppen der Anwendung beendet ihn nicht. Er entpackt das Paket und führt dessen `install.sh --upgrade` aus.
- **Windows:** Der Dienst `craftmanager-updater` (LocalSystem) prüft die Anfrage und startet die Installation über eine einmalige Aufgabe der Aufgabenplanung (SYSTEM) mit einer *Kopie* von `node.exe` und `updater.mjs`, weil der Installer Dienst und Programmdateien ersetzt. Das Setup läuft still (`/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`); Konfiguration, Token, Daten, Server und die vorhandene Auswahl für Firewall-Regeln und Startmenü bleiben erhalten.

**So veröffentlicht der Besitzer ein Update**

1. Einmalig: Repository öffentlich machen. Schlüsselpaar erzeugen: `node scripts/update-keygen.mjs --out private.pem`. Den ausgegebenen öffentlichen Schlüssel in `packages/backend/src/update/keys.ts` eintragen, den Inhalt von `private.pem` als Actions-Secret **`UPDATE_SIGNING_KEY`** hinterlegen (Einstellungen > Secrets and variables > Actions) und die Datei sicher aufbewahren, nie ins Repository legen. Ohne das Secret bricht `release.yml` ab.
2. Version in `package.json`, `packages/backend/package.json` und `packages/frontend/package.json` erhöhen, committen, Tag `vX.Y.Z` setzen und pushen. Der Workflow baut alle Pakete, signiert `SHA256SUMS.txt` und legt das Release an. Der Text des Releases wird den Administratoren als Versionshinweis angezeigt.
3. Schlüsselwechsel (Rotation): Neuen öffentlichen Schlüssel **zusätzlich** zum alten in `keys.ts` eintragen und ein Release noch mit dem alten Schlüssel signieren. Haben die Installationen es übernommen, mit dem neuen Schlüssel signieren und später den alten entfernen. Ein verlorener oder offengelegter Schlüssel lässt sich nur durch ein manuell installiertes Paket mit neuem Schlüssel ersetzen.
4. Vorabversionen: Tag `v1.2.0-rc.1` (wird als Prerelease markiert); nur Installationen mit `UPDATE_CHANNEL=prerelease` sehen sie.

Prüfen ohne Netz: `node scripts/sign-release.mjs --sums SHA256SUMS.txt --key-file private.pem` signiert und weist einen Schlüssel zurück, der nicht in `keys.ts` steht.

**API:** `GET /api/system/update` (Zustand: `currentVersion`, `installMode` `service|portable|dev`, `latest` mit Versionshinweisen, `updateAvailable`, `canApply` samt Grund, `phase`, `progress`, `lastCheckAt`, `lastCheckError`, `history`), `POST /api/system/update/check`, `POST /api/system/update/apply` mit `{ "confirm": true, "countdownSeconds"?: 0-600 }` (ohne `confirm: true` `422`), `POST …/cancel`, `POST …/dismiss`, `PATCH …/settings` mit `{ "autoCheck": boolean }`. Änderungen kommen als Ereignis `update.state` über `/api/events`. Alle Routen verlangen wie die übrige API die Anmeldung.

**Test-Pakete (nur CI):** `package.mjs --version-override X.Y.Z --test-update-api <URL> --test-update-key <Datei.pem>` baut ein Paket mit der Markierung `tools/update-test.json`. Nur mit ihr beachtet die Anwendung `UPDATE_API_BASE` (auch `http://`) und einen zusätzlichen Testschlüssel; die Datei liegt im Programmordner (nur root bzw. Administratoren können sie anlegen), Pakete von `release.yml` enthalten sie nicht. In der CI prüft `scripts/ci/update-e2e-linux.sh` (Ubuntu) und `scripts/ci/update-e2e-windows.ps1` (windows-latest) das ganze Verfahren mit einem falschen GitHub (`scripts/ci/fake-github.mjs`) und einem Wegwerf-Schlüssel, einschließlich manipuliertem Paket, gefälschter Anfrage und Rollback einer kaputten Version.

## Sicherheit

- **Host-Prüfung (DNS-Rebinding):** Jede Anfrage, auch `GET` und WebSocket-Aufbau, braucht einen `Host`-Header mit einer IP-Adresse (IPv4/IPv6), `localhost`, `*.localhost`, dem Rechnernamen (ohne Beachtung der Groß-/Kleinschreibung, auch mit `.local`, `.lan`, `.home`, `.home.arpa` oder `.fritz.box`) oder einem Eintrag aus `ALLOWED_HOSTS`. Sonst antwortet die API mit `403 HOST_FORBIDDEN`, ebenso bei fehlendem `Host`. Das verhindert, dass eine Webseite mit umgebogener DNS-Auflösung die API im Browser eines LAN-Nutzers ansteuert. Der Vite-Dev-Proxy über `localhost` ist erlaubt. Wer die Oberfläche unter einem eigenen Namen erreicht, trägt ihn in `ALLOWED_HOSTS` ein.
- **Origin-Prüfung:** Bei allen Anfragen außer `GET`/`HEAD` und bei jedem WebSocket-Aufbau muss ein vorhandener `Origin`-Header zum `Host` der Anfrage passen, sonst `403 ORIGIN_FORBIDDEN`. Das verhindert, dass eine fremde Webseite im Browser eines LAN-Nutzers den Server steuert. Anfragen ohne `Origin` (curl, Skripte) sind erlaubt.
- **Anmeldung (optional):** Mit `AUTH_TOKEN` verlangt jede Route außer `GET /api/health`, `GET /api/auth/status`, `POST /api/auth/login` und `POST /api/auth/logout` eine Anmeldung per `Authorization: Bearer <Token>` oder per HttpOnly/SameSite=Strict-Cookie. Das Cookie setzt `POST /api/auth/login` mit `{ "token": "..." }`, `POST /api/auth/logout` löscht es. WebSockets nutzen dasselbe Cookie oder den Bearer-Header. Das Token wird zeitkonstant verglichen. Ist in der Weboberfläche ein Passwort gesetzt, gilt für `POST /api/auth/login` dieses statt des Tokens (Hash: scrypt, siehe [Passwort](#passwort-der-weboberfläche)); der Bearer-Zugang mit dem Token bleibt. Nach 5 falschen Anmeldungen innerhalb von 5 Minuten wird die IP-Adresse mit `429 TOO_MANY_ATTEMPTS` gesperrt. Ohne HTTPS wird das Token im LAN unverschlüsselt übertragen; die Anmeldung schützt vor Zufallszugriffen, nicht vor Mitlesern im Netz. `/api/health` liefert ohne Anmeldung nur `status` und `database`.
- Der Java-Pfad eines Servers muss auf eine Datei namens `java` bzw. `java.exe` zeigen und `-version` beantworten (`422 JAVA_INVALID`), wird aber ausgeführt. Wer die API erreicht, kann damit Programme starten; deshalb bei Bedarf `AUTH_TOKEN` setzen.

## Weboberfläche

Die Oberfläche ist ein dunkles Betriebs-Dashboard für Telefon, Tablet und Desktop, komplett auf Deutsch. Sie bietet:

- **Übersicht** mit Status, CPU, Arbeitsspeicher, Spielern, Port und Start/Stopp/Neustart/Erzwingen je Server, live über `/api/events`, dazu LAN-Adressen und Arbeitsspeicher des Rechners.
- **Assistent** für neue Server: Loader, Version mit Snapshot-Schalter, Loader-Version, Port, Arbeitsspeicher-Regler bis zum echten Maximum des Rechners, Java-Warnung und ein EULA-Haken, der standardmäßig leer ist. Danach folgen Live-Installationsprotokoll und Wiederholen bei Fehlern.
- **Mods:** Schalter je Eintrag (ausgeschaltete sind abgeblendet, Filter Alle/Aktiv/Deaktiviert), Dialoge zum „Trotzdem deaktivieren“ und Meldung der mit aktivierten Abhängigkeiten, im Store „Deaktiviert“ mit „Aktivieren“, dazu die Ansicht „Backups der Updates“ mit „Aufräumen“.
- **Backups:** eigener Bereich je Server mit Liste, Erstellen, Herunterladen, Wiederherstellen mit Bestätigung, Löschen und Zeitplan; beim Löschen eines Servers mit Backups die Wahl „löschen oder behalten“.
- **Java:** Fortschritt im Assistenten, im Installationsbereich und auf der Server-Seite, Liste der Laufzeiten mit Herkunft in der Konfiguration samt „Java N installieren“ und „Entfernen“; statt der Sackgasse „Java-Laufzeit einstellen“ bietet ein Startfehler „Java N installieren“ an. Die Warnung zu fehlendem Java im Assistenten erscheint nur noch bei `JAVA_AUTO_INSTALL=false`.
- **Server-Seite** mit den Bereichen Konsole (History, Live-Zeilen, Befehlsverlauf, Filter, Wiederverbinden ohne Lücken oder Doppelte), Konfiguration (`server.properties`, Java, Arbeitsspeicher, EULA, Umbenennen, Löschen mit Namensbestätigung), Mods bzw. Plugins (Paper) und Mod-Store bzw. Plugin-Store.
- **System** mit Version, **Netzwerk & Zugriff** (Adressen im Heimnetz, Bind-Adresse, Port, Rechnernamen, Neustart), **Passwort**, Updates und Verlauf.
- **Hinweis** „Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.“ auf jeder Seite (Seitenleiste bzw. Fußzeile, auch bei 360 px) und auf der Anmeldeseite.
- **Anmeldung**, sobald `AUTH_TOKEN` oder ein Passwort gesetzt ist; ein `401` an beliebiger Stelle führt zurück zur Anmeldung.

Die Oberfläche braucht kein Internet: Schriften sind eingebunden, es gibt keine CDN-Skripte. Einzige externe Bilder sind die Symbole von Modrinth (`cdn.modrinth.com`); fehlen sie, erscheint ein Buchstabenfeld. Sie nutzt keine Browser-Funktionen, die nur über HTTPS oder localhost verfügbar sind, und läuft daher auch über `http://<LAN-IP>`. Alle Texte von Servern und Modrinth werden als Text dargestellt, nie als HTML. HTML-Antworten tragen `Content-Security-Policy` (nur eigene Quellen, Bilder zusätzlich von `cdn.modrinth.com`), `X-Frame-Options: DENY` und `X-Content-Type-Options: nosniff`. Host-, Origin- und Anmelde-Prüfung gelten unverändert; die Oberfläche selbst (HTML, Skripte, Schriften) ist ohne Anmeldung abrufbar, jeder Pfad unterhalb von `/api` nicht.

## Server anlegen, installieren, starten

1. `POST /api/servers` legt den Datensatz an und antwortet sofort mit `201` und `installState: "pending"`. Die Installation läuft danach im Hintergrund (`installing`, dann `installed` oder `failed` mit `installError`). Fortschritt und Protokoll kommen als Ereignisse über `/api/events` und stehen in `<SERVERS_DIR>/<Server-ID>/install.log`. Eine fehlgeschlagene Installation startet `POST /api/servers/:id/install` erneut. Beim Programmstart werden hängen gebliebene Installationen als fehlgeschlagen („unterbrochen“) markiert.
2. **EULA:** Der Server startet nur, wenn für ihn ausdrücklich zugestimmt wurde (`eulaAccepted: true` beim Anlegen oder per `PATCH`). Die Anwendung stimmt nie von selbst zu. Erst danach schreibt sie beim Start `eula.txt` mit `eula=true`. Wird die Zustimmung zurückgenommen, wird `eula=false` geschrieben. Die EULA steht unter https://aka.ms/MinecraftEULA.
3. **Start** prüft der Reihe nach: installiert, EULA, passende Java-Version (`422 JAVA_NOT_FOUND` / `JAVA_VERSION_INCOMPATIBLE`), Port, Portkonflikt mit anderen laufenden Servern und ein echter Bind-Test auf `0.0.0.0` und `127.0.0.1` (`409 PORT_IN_USE`). Der Port aus `server.properties` ist maßgeblich; die Datenbank wird daran angepasst. Zustände (`offline`, `starting`, `online`, `stopping`, `crashed`) liegen nur im Speicher. Ein Absturz wird nicht automatisch neu gestartet.
4. Beim Start wird im Hintergrund eine Update-Prüfung der Mods angestoßen (nicht bei Vanilla). Das Ergebnis kommt als Ereignis `mods.updates` und blockiert den Start nie.

### Unterstützte Loader

| Loader   | Quelle                                                             | Prüfung des Downloads                  | Installation                                |
| -------- | ------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------- |
| Vanilla  | Mojang (`piston-meta.mojang.com`)                                  | SHA-1 und Größe                        | `server.jar`                                |
| Fabric   | `meta.fabricmc.net`                                                | keine Prüfsumme veröffentlicht: Host und ZIP-Format | `fabric-server-launch.jar`      |
| Paper    | PaperMC Fill v3 (`fill.papermc.io`), bevorzugt Stable-Builds      | SHA-256 und Größe                      | `paper-<Version>-<Build>.jar`               |
| NeoForge | `maven.neoforged.net` (nicht für Minecraft 1.20.1, dort Forge nutzen) | SHA-512/256/1 aus der veröffentlichten Datei | Installer mit `--install-server`     |
| Forge    | `files.minecraftforge.net`, Installer von `maven.minecraftforge.net` (ab Minecraft 1.7.2) | SHA-512/256/1 aus der veröffentlichten Datei | Installer mit `--installServer` |

Die benötigte Java-Version stammt aus den Mojang-Versionsdaten der jeweiligen Minecraft-Version (bei Paper zusätzlich der Wert von PaperMC). Forge bis Minecraft 1.12.2 läuft nur mit Java 8 und wird mit höheren Versionen abgelehnt. Downloads sind auf diese Hosts beschränkt (Weiterleitungen eingeschlossen): `piston-data.mojang.com`, `launcher.mojang.com`, `meta.fabricmc.net`, `fill-data.papermc.io`, `maven.neoforged.net`, `maven.minecraftforge.net` (Mods wie bisher nur `cdn.modrinth.com`). Versionslisten werden fünf Minuten zwischengespeichert. Moderne Forge- und NeoForge-Installationen werden über `@libraries/.../win_args.txt` bzw. `unix_args.txt` gestartet (je nach Betriebssystem), ältere Forge-Versionen über die erzeugte `forge-*.jar`.

### Java-Erkennung

`GET /api/system` listet gefundene Java-Installationen (`JAVA_HOME`, `PATH`, `Program Files\Java`, Eclipse Adoptium, Microsoft, Zulu, BellSoft, Amazon Corretto, Semeru, `/usr/lib/jvm`, `/Library/Java/JavaVirtualMachines` sowie die von CraftManager selbst installierten Laufzeiten) mit Hauptversion. Von CraftManager installierte Laufzeiten haben `source: "managed"` und in `origin` eine Erklärung ihrer Herkunft; `managedJava` nennt Größe, Prüfsumme und welche Server sie gerade verwenden, `javaInstalls` laufende Installationen und `javaAutoInstall` den Wert von `JAVA_AUTO_INSTALL`. `?rescan=true` erzwingt eine neue Suche; sonst gilt ein kurzer Zwischenspeicher. Ohne eingestellten `javaPath` wird die niedrigste passende Version gewählt (bei Forge bis 1.12.2 genau Java 8). Ein eingestellter `javaPath` wird nie automatisch ersetzt.

### Automatische Java-Installation

Fehlt für einen Server die passende Java-Version, installiert CraftManager sie selbst, sowohl für die Installer von Forge/NeoForge als auch beim Start (`JAVA_AUTO_INSTALL=false` stellt die bisherigen Fehler `JAVA_NOT_FOUND`/`JAVA_VERSION_INCOMPATIBLE` wieder her; das manuelle Installieren in der Oberfläche bleibt möglich).

- **Quelle:** Eclipse Temurin über die Adoptium-API (`https://api.adoptium.net/v3/assets/latest/<Version>/hotspot`). Die Metadaten liefern Download-Link, Größe und SHA-256. Erlaubt sind nur die drei Hosts, die ein Download tatsächlich berührt (am 5.11.2026 geprüft, auch für Java 8, 17, 21 und 25): `api.adoptium.net`, `github.com` (Weiterleitung auf das Release) und `release-assets.githubusercontent.com`. Jede Weiterleitung wird einzeln gegen diese Liste geprüft.
- **Ziel:** `<DATA_DIR>/runtimes/temurin-<Hauptversion>/`, nur für CraftManager. Es gibt keine Installation im System und keine Änderung an PATH oder Registry.
- **Ablauf:** Download nach `.tmp-*`, Größe und SHA-256 prüfen, sicher entpacken (zip unter Windows, tar.gz unter Linux/macOS; Pfade außerhalb des Zielordners, absolute Pfade, `..`, Symlinks aus dem Ordner heraus und zu große Archive werden abgelehnt), `java -version` ausführen und die Hauptversion prüfen, dann Marker schreiben und den Ordner mit einem Rename an seinen Platz setzen. Abgebrochene oder fehlgeschlagene Läufe hinterlassen nichts Verwendbares; Reste (`.tmp-*`, `.removing-*`, Ordner ohne Marker) werden beim Start gelöscht. Vor dem Download wird der freie Speicherplatz geprüft.
- **Plattformen:** win32/linux/darwin mit x64/arm64. Gibt es eine Kombination bei Adoptium nicht (z. B. Java 8 unter Windows arm64), kommt `422 JAVA_NOT_AVAILABLE` mit einer deutschen Erklärung, bei unbekannten Plattformen `JAVA_PLATFORM_UNSUPPORTED`.
- **Welche Version:** Es wird die niedrigste langfristig unterstützte Version installiert, die den Server erfüllt (8, 11, 17, 21, 25; Minecrafts Java 16 wird 17), darüber die genaue Mindestversion. Obergrenzen werden beachtet: Forge bis 1.12.2 bekommt genau Java 8.
- **JRE statt JDK:** Es wird das JRE-Image geladen (etwa 40 bis 60 MB statt 100 bis 200 MB). Server-Jars und die Installer brauchen nur die Laufzeit, keinen Compiler. Geprüft wurde: Das JRE 21 und 25 enthält alle Laufzeitmodule (u. a. `jdk.unsupported`, `jdk.zipfs`, `jdk.crypto.ec`, `jdk.management`, `jdk.jfr`, `java.sql`); es fehlen nur Entwicklerwerkzeuge wie `jdk.compiler`. Mit dem JRE 8 lief der echte Forge-1.12.2-Installer fehlerfrei durch. Nicht von Hand geprüft sind moderne Forge- und NeoForge-Installer sowie ein echter Serverstart mit dem JRE. Gibt es für eine Version und Plattform kein JRE-Image, nimmt CraftManager automatisch das JDK.
- **Eine Installation pro Version:** Fragen mehrere Server oder Aufträge gleichzeitig dieselbe Version an, teilen sie sich einen Download samt Fortschritt. Er wird erst abgebrochen, wenn der letzte Wartende aufgegeben hat (oder die Anwendung endet).

**Ablauf beim Start (ohne Warten im Request):** `POST /api/servers/:id/start` antwortet sofort. Fehlt Java, wechselt der Server in den neuen Zustand `preparing` (Oberfläche: „Bereitet vor“) mit der Meldung „Java 21 wird installiert ...“. Fortschritt und Schritte erscheinen in der Konsole des Servers (Systemzeilen), im Status (`message`) und als Ereignis `java.install`. Die Installation läuft im Hintergrund **ohne** die Server-Sperre zu halten (sonst blockierte sie z. B. das Speichern von Eigenschaften); der Server zählt aber als laufend, weshalb Löschen, Mod-Änderungen, Installation und ein zweiter Start mit `409` abgelehnt werden. Ist die Laufzeit da, läuft der normale Startpfad unter der Sperre erneut (Port, EULA, Dateien werden neu geprüft) und der Zustand geht über `starting` nach `online`. Ein Fehler (Download, Prüfsumme, Port belegt ...) endet als `crashed` mit lesbarer Meldung und Konsolenzeile. **Stoppen, Erzwingen und Neustart** brechen die Vorbereitung ab (Zustand `offline`, kein Prozess); der Download läuft für andere Server weiter. **Beim Beenden der Anwendung** werden Vorbereitungen abgebrochen und die laufende Installation samt `.tmp`-Ordner aufgeräumt. In der Oberfläche heißt der Stopp-Knopf in dieser Phase „Abbrechen“.

Die Liste der Laufzeiten mit Herkunft, „Java N installieren“ und „Entfernen“ (nur wenn kein laufender Server sie verwendet, `409 JAVA_IN_USE`) steht in der Konfiguration eines Servers.

## API

Fehler haben immer die Form `{ "error": { "code", "message", "details?" } }`. Bodylose `POST`-Anfragen sind auch mit `Content-Type: application/json` erlaubt.

System und Loader:

- `GET /api/java/runtimes` (Liste, `?rescan=true`), `POST /api/java/runtimes/:major/install` (wartet bis zum Ende, idempotent), `DELETE /api/java/runtimes/:major` – von CraftManager installierte Java-Laufzeiten

- `GET /api/health` – Status, Version, Laufzeit, Datenbank, LAN-Adressen
- `GET /api/system/network` (Adressen: `lan`, `virtual`, `hostnameUrl`; `active`, `settings`, `defaults`, `pending`, `restartRequired`, `warnings`), `PUT /api/system/network` mit `{ bindHost?, port?, allowedHosts?, publicAddress? }` (`null` = Wert der Konfigurationsdatei; Fehler `422 NETWORK_ADDRESS_UNKNOWN | NETWORK_PORT_IN_USE | NETWORK_PORT_DENIED | NETWORK_HOST_INVALID | NETWORK_PUBLIC_INVALID`), `POST /api/system/restart` mit `{ "confirm": true }` (ohne `422`), antwortet `202` und beendet CraftManager mit Exit-Code 75
- `GET /api/system/update`, `POST /api/system/update/check | apply | cancel | dismiss`, `PATCH /api/system/update/settings` – Selbst-Update, siehe [Updates](#updates)
- `GET /api/system?rescan` – Arbeitsspeicher, CPU-Anzahl, Plattform, Java-Installationen
- `GET /api/loaders` – verfügbare Loader
- `GET /api/loaders/:loader/mc-versions?snapshots=true` – Minecraft-Versionen des Loaders
- `GET /api/loaders/:loader/versions?mcVersion=` – Loader-Versionen (mit `stable` und `recommended`)

Server:

- `GET /api/servers`, `GET /api/servers/:id` – Server mit Laufzeitstatus (`status`: Zustand, PID, Spieler, CPU in Prozent der gesamten Maschine, Arbeitsspeicher)
- `POST /api/servers` mit `{ name, loader, mcVersion, loaderVersion?, port?, minRamMb?, maxRamMb?, eulaAccepted? }`
- `PATCH /api/servers/:id` mit `{ name, minRamMb, maxRamMb, javaPath, useAikarFlags, extraJvmArgs, eulaAccepted }` (alle optional; Antwort enthält `restartRequired`)
- `DELETE /api/servers/:id?confirm=true` – nicht bei laufendem Server oder laufender Installation; entfernt nur `<SERVERS_DIR>/<UUID>`
- `POST /api/servers/:id/install | start | stop | restart | kill` – `start` antwortet auch bei fehlender Java-Version sofort (Zustand `preparing`)
- `POST /api/servers/:id/command` mit `{ command }` (höchstens 1024 Zeichen, keine Zeilenumbrüche)
- `GET /api/servers/:id/console/history?limit=` – letzte Konsolenzeilen (Puffer: 2000 Zeilen)
- `GET /api/servers/:id/properties`, `PATCH /api/servers/:id/properties` – `server.properties` (Port, Spielmodus, Schwierigkeit, Whitelist, Spielerzahl, Sichtweite, Online-Modus, MOTD). Kommentare, Reihenfolge und unbekannte Einträge bleiben unverändert; der Port wird nach dem Schreiben auch in der Datenbank nachgeführt.

Mod-Verwaltung (je Server unter `/api/servers/:serverId`; Fabric, Forge, NeoForge nutzen `mods/`, Paper nutzt `plugins/`, Vanilla wird mit `409 MODS_NOT_SUPPORTED` abgelehnt):

- `GET /mods` – installierte Mods
- `GET /mods/search?query&categories&limit&offset&index` – Modrinth-Suche, fest auf Minecraft-Version, Loader und serverseitige Mods gefiltert
- `POST /mods` mit `{ projectId, versionId? }` – installiert inklusive aller benötigten Abhängigkeiten (alles oder nichts)
- `DELETE /mods/:modId?force=true` – entfernt einen Mod; ohne `force` Fehler `MOD_REQUIRED_BY_OTHERS`, wenn andere Mods ihn benötigen
- `POST /mods/scan` – gleicht den Ordner (SHA-512) mit der Datenbank ab und erkennt manuelle Dateien über Modrinth
- `POST /mods/updates/check` und `POST /mods/updates/apply` mit `{ projectIds? }` – Updates prüfen und sicher einspielen (Backup in `mods_backup/` bzw. `plugins_backup/`)
- `GET /mods/update-log?limit` – Update-Protokoll
- `GET /api/modrinth/categories` – Modrinth-Kategorien

- `PATCH /mods/:modId` mit `{ enabled, force? }` – schaltet einen Mod oder ein Plugin an oder aus (siehe unten)
- `GET /mods/backups` – Backups, die Updates hinterlassen haben (Größe, zugehöriger Mod, was aufgeräumt würde), `POST /mods/backups/cleanup` räumt auf

Installieren, Aktualisieren, Löschen und An-/Ausschalten von Mods sind bei laufendem Server gesperrt (`409 SERVER_RUNNING`). Start, Installation, Löschen und Mod-Änderungen eines Servers teilen sich eine Sperre und laufen nie gleichzeitig.

**Mods an- und ausschalten:** Ein ausgeschalteter Mod heißt `<Name>.jar.disabled` im selben Ordner; Loader ignorieren ihn. In der Datenbank bleibt der Name ohne `.disabled` und die Spalte `enabled` (Standard `true`) hält den Zustand. Der Scan erkennt `.jar.disabled` über den Hash als denselben Mod: Von Hand umbenannte Dateien schalten den Zustand um (`toggled` im Scan-Bericht), Umbenennen und Ersetzen funktionieren wie bisher. Liegen `a.jar` und `a.jar.disabled` nebeneinander, gewinnt die aktive Datei, die andere wird mit Warnung ignoriert; es entstehen keine Doppelten und es gehen keine Einträge verloren.

- Ausschalten eines Mods, den aktive andere Mods benötigen: `409 MOD_REQUIRED_BY_OTHERS` mit den Abhängigen, außer mit `force`. Ausgeschaltete Abhängige zählen nicht.
- Einschalten eines Mods mit ausgeschalteten benötigten Abhängigkeiten: schaltet sie rekursiv mit ein und meldet sie in `dependencies` und `warnings`; `409 MOD_INCOMPATIBLE`, wenn er mit einem aktiven Mod kollidiert (nichts wird geändert).
- Installieren eines Mods, dessen Abhängigkeit ausgeschaltet vorhanden ist, schaltet sie wieder ein (`reenabled`, Hinweis in `warnings`). Unverträglichkeiten zählen nur zwischen aktiven Mods. Ein schon vorhandener, aber ausgeschalteter Mod ergibt beim Installieren `409 MOD_DISABLED`.
- Updates funktionieren auch bei ausgeschalteten Mods: Die neue Datei bleibt `.jar.disabled`, Backup und Rückgängigmachen erhalten den Zustand. Löschen entfernt beide Schreibweisen. Bei jedem Fehler wird alles zurückgesetzt (Dateien und Datenbank). Gesperrte Dateien ergeben `409 FILE_LOCKED`.

**Backups der Updates:** Nach jedem Update bleiben pro Mod nur die neuesten `MOD_BACKUP_KEEP` (Standard 3) Dateien in `mods_backup/` bzw. `plugins_backup/`; das gerade angelegte wird nie gelöscht. Dateien, die keinem Update zugeordnet sind, bleiben unangetastet. Die Oberfläche zeigt Größe und „Aufräumen“.

Welt-Backups (je Server unter `/api/servers/:serverId`):

- `GET /backups` – Liste mit Art (`manual`, `auto`, `safety`), Status (`running`, `ok`, `failed`), Größe, Zeitplan und freiem Speicher
- `POST /backups` mit `{ includeConfig? }` – startet ein Backup und antwortet sofort mit `202`; Ergebnis über Ereignis `backup.changed`
- `GET /backups/:backupId/download` – das Archiv (mit Anmeldung, falls `AUTH_TOKEN` gesetzt ist; der Dateiname kommt nie aus der Anfrage)
- `POST /backups/:backupId/restore` – nur bei gestopptem Server (`409 SERVER_RUNNING`)
- `DELETE /backups/:backupId`, `PATCH /backups/schedule` mit `{ intervalHours (1 bis 720 oder null), keepLast (1 bis 100), includeConfig }`
- `DELETE /api/servers/:id?confirm=true&backups=delete|keep` – hat der Server Backups, muss `backups` angegeben werden (sonst `409 BACKUPS_DECISION_REQUIRED`); `keep` lässt die Archive mit einer `server.json` im Ordner liegen

Die Archive liegen als `.tar.gz` in `<DATA_DIR>/backups/<Server-ID>/`. Gesichert werden die Welt aus `level-name` der `server.properties` (Standard `world`) mit `<Name>_nether` und `<Name>_the_end`, ohne `session.lock`, Symlinks werden übersprungen. Mit `includeConfig` kommen `server.properties`, `ops.json`, `whitelist.json`, `banned-players.json`, `banned-ips.json`, `bukkit.yml`, `spigot.yml`, `paper.yml`, `commands.yml`, `permissions.yml`, `help.yml` und die Ordner `config` und `defaultconfigs` dazu. Das Archiv enthält `craftmanager-backup.json`.

- **Laufender Server:** `save-off`, dann `save-all flush`, dann Warten auf die echte Bestätigung in der Konsole (erkannt werden die Texte von Vanilla, Paper, Forge und älteren Versionen wie „Automatic saving is now disabled“, „Saved the game“/„Saved the world“, auch in `[Server: ...]`; Chat-Zeilen lösen nichts aus; Zeitlimits 30 s, 5 min und 30 s), Archivieren, **immer** `save-on` danach, auch bei Fehlern und Zeitüberschreitungen. Ein Backup blockiert und beendet den Server nie; wird er währenddessen gestoppt, wird das unvollständige Backup verworfen. Kennt ein sehr alter Server `flush` nicht, folgt ein einfaches `save-all`.
- **Gestoppter Server:** einfaches Archiv unter der Server-Sperre.
- **Wiederherstellen:** entpackt zuerst in einen Ordner im Serverordner (Zip-Slip-Schutz, Größenlimit, Inhalt muss zur Beschreibung passen), legt dann ein Sicherheits-Backup des aktuellen Stands an (scheitert es, bricht die Wiederherstellung ab) und tauscht zuletzt die Ordner; bei einem Fehler wird alles zurückgesetzt, die alte Welt bleibt erhalten.
- **Zeitplan und Aufbewahrung:** Alle N Stunden, auch bei laufendem Server; ein gestoppter Server mit unveränderter Welt wird übersprungen. Der Zeitplan steht in der Datenbank und übersteht Neustarts. Nach einem automatischen Backup werden nur ältere **automatische** über `keepLast` hinaus gelöscht, handgemachte und Sicherheits-Backups nie.
- Ein fehlgeschlagenes Backup wird protokolliert, als Datensatz mit Fehlertext gespeichert, als Ereignis gemeldet und in der Server-Konsole angezeigt. Vor dem Schreiben wird der freie Speicherplatz geprüft (`507 DISK_FULL`-Meldung im Datensatz). Unterbrochene Backups werden beim Start als fehlgeschlagen markiert, Teildateien gelöscht.

**Welten importieren und exportieren:** Eine vorhandene Welt (mit oder ohne Mods) lässt sich als Archiv ein- und ausführen. In der Oberfläche: Assistent „Neuer Server“ → „Aus vorhandener Welt“ (`/new/world`) sowie auf der Seite eines Servers unter „Backups“ die Abschnitte „Welt exportieren“ und „Welt ersetzen“ (nur bei gestopptem Server); jedes Backup lässt sich zusätzlich als Welt-Archiv exportieren.

Export (je Server, Pfade unter `/api`):

- `POST /servers/:serverId/exports` mit `{ format: "zip"|"tar.gz", mods: "none"|"manifest"|"jars", includeConfig }` startet den Export (`202`, `{ export }`). `GET /exports/:exportId` zeigt `status` (`running`, `ready`, `failed`), `GET /exports/:exportId/download` liefert die Datei als Datenstrom mit `Content-Length`, `DELETE /exports/:exportId` räumt auf. Fertige Exporte liegen etwa 30 Minuten in `<DATA_DIR>/tmp/exports`.
- `POST /servers/:serverId/backups/:backupId/export` mit `{ format }` exportiert ein Backup als Welt-Archiv.
- Das Archiv enthält die Welt (`level-name`, `_nether`, `_the_end`) und `craftmanager-export.json` (Format, App-Version, Minecraft-Version, Loader und Loader-Version, Mods mit Name, Dateiname, SHA-1/SHA-512, Modrinth-Projekt/-Version, aktiv/deaktiviert, Seite, Exportzeit); mit `includeConfig` die Konfigurationsdateien, mit `mods: "jars"` die Jar-Dateien in `mods/` bzw. `plugins/`. Läuft der Server, gilt wie beim Backup `save-off`, `save-all flush`, Archivieren, immer `save-on`. Das Archiv wird zuerst in `<DATA_DIR>/tmp` geschrieben (der freie Speicher wird geprüft); so hängt das Speichern des Servers nicht von der Download-Geschwindigkeit ab.

Import:

- `POST /imports[?serverId=<id>]`: Der Upload ist der rohe Request-Body (`Content-Type: application/octet-stream`, kein Multipart), wird in Stücken auf die Platte geschrieben und ist durch `IMPORT_MAX_MB` begrenzt (`413 IMPORT_TOO_LARGE`). Mit `serverId` ist er für das Ersetzen der Welt dieses gestoppten Servers gedacht. Antwort `202`; die Prüfung läuft im Hintergrund, `GET /imports/:importId` liefert `status` (`analyzing`, `staged`, `applying`, `done`, `failed`) und die Analyse. Dazu `GET /imports/limits` und `DELETE /imports/:importId`.
- Akzeptiert werden `.zip` und `.tar.gz`: ein CraftManager-Export, eine Einzelspieler-Welt (`level.dat` im Wurzelordner oder eine Ebene tiefer, auch mit `DIM-1`/`DIM1`) oder ein ganzer Server-Ordner mit `server.properties`, Welt und `mods/`. Abgelehnt werden Zip-Slip, Symlinks, zu viele Einträge, zu große entpackte Daten, ein auffälliges Verhältnis von entpackter zu gepackter Größe (`ARCHIVE_UNSAFE`, `ARCHIVE_TOO_LARGE`, `ARCHIVE_BOMB`) und Bedrock-Welten. Zwischenstände liegen in `<DATA_DIR>/tmp/imports` und werden nach Fehlern, Abbruch, Zeitablauf (2 Stunden) und beim Start gelöscht.
- Analyse: `level.dat` wird mit einem eigenen NBT-Leser gelesen (`Version.Name`, `DataVersion`, Name, Spielmodus, Hardcore, Forge-Modliste aus `FML`/`fml`, `ServerBrands`). Fehlt der Versionsname, wird die Version aus der `DataVersion` geschätzt; ohne beides („älter als 1.9“) muss die Version selbst gewählt werden. Mods werden aus `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `neoforge.mods.toml`, `mcmod.info`, `plugin.yml` und dem Manifest erkannt. Vorgeschlagen werden Loader, Loader-Version (die empfohlene) und Minecraft-Version.
- `POST /imports/:importId/review` mit `{ loader, mcVersion }` liefert Hinweise zum gewählten Ziel (eine neuere Welt als der Server blockiert mit `WORLD_NEWER`; ältere Welt, Mods ohne passenden Loader, Wechsel Fabric/Forge u. a. brauchen eine Bestätigung) und den Mod-Abgleich: Jar-Dateien werden über ihren SHA-512 auf Modrinth erkannt (dann sind sie aktualisierbar), Mods ohne Datei werden über Projekt-ID, Slug oder Suche gefunden; `not-found` heißt fehlend.
- `POST /imports/:importId/create-server` mit `{ server: <wie POST /servers>, importConfig, selection: { jars, install }, acknowledged }` legt den Server an (EULA wie angegeben, freier Port), setzt die Welt ein, legt die gewählten Jar-Dateien ab (der Scan macht sie als manuelle Mods verwaltbar und verknüpft sie über den Hash mit Modrinth) und installiert gewählte Modrinth-Mods samt Abhängigkeiten nach der Server-Installation.
- `POST /servers/:serverId/world/replace` mit `{ importId, acknowledged }` nur bei gestopptem Server: Sicherheits-Backup, dann Austausch der Ordner; bei einem Fehler wird alles zurückgesetzt.
- Dimensionen: Vanilla, Fabric, Forge und NeoForge legen Nether und End im Weltordner ab (`DIM-1`, `DIM1`), Paper daneben (`<Name>_nether/DIM-1`, `<Name>_the_end/DIM1`). Beim Import wird in das Format des Zielservers umgeordnet; der Einzelspieler-Spielstand aus `level.dat` wird als `playerdata/<UUID>.dat` übernommen.

**Installationsprotokoll:** `GET /api/servers/:id/install-log?tail=500` (1 bis 5000) liefert `{ lines: [{ seq, time, text }], totalLines, truncated }` aus `install.log` (Datei wird nur gelesen, wenn sie eine normale Datei ist; Steuerzeichen werden entfernt). `seq` ist die Zeilennummer in der Datei und kommt auch in jedem Ereignis `install.log`; so führt die Oberfläche Datei und Live-Zeilen ohne Doppelte und Lücken zusammen.

**Autostart:** `PATCH /api/servers/:id` mit `{ autoStart: true }`. Nach dem Start der Anwendung (nach der Wiederherstellung unterbrochener Installationen und Backups) werden diese Server nacheinander und ohne den Webserver zu blockieren gestartet, in der Reihenfolge der Anlage, nur mit zugestimmter EULA und fertiger Installation. Fehlt Java, wird es zuerst installiert, bevor der nächste Server folgt. Ein Fehler wird protokolliert und als Status (`crashed` mit Meldung) des betroffenen Servers gezeigt; die anderen starten trotzdem. Den Start von CraftManager mit dem Rechner übernehmen der Windows-Dienst bzw. der systemd-Dienst der Installationspakete.

Authentifizierung: `GET /api/auth/status` (`authRequired`, `authenticated`, `credential` = `none | token | password`), `POST /api/auth/login` mit `{ "token": "…" }` (auch `{ "password": "…" }`), `POST /api/auth/logout`, `POST /api/auth/password` mit `{ currentPassword?, newPassword }` (`403 CURRENT_PASSWORD_WRONG`, `422 PASSWORD_TOO_WEAK | PASSWORD_UNCHANGED`, `429`).

### WebSockets

Beide Endpunkte senden JSON-Nachrichten. Langsame Clients (mehr als 1 MiB unversendete Daten) werden getrennt.

- `ws://<Host>/api/servers/:id/console?history=1000` – beim Verbinden `{type:"status",status}` und `{type:"history",lines}`, danach `{type:"line",line}` und `{type:"status",status}`. Der Client sendet `{type:"command",command,id?}` und erhält `{type:"ack",id?}` oder `{type:"error",code,message,id?}`; auch `{type:"ping"}` wird beantwortet. Fehler und ungültiges JSON schließen die Verbindung nicht. Eine Zeile hat `seq`, `time`, `stream` (`stdout`, `stderr`, `system`, `input`) und `text`.
- `ws://<Host>/api/events` – zuerst `{type:"snapshot",servers}`, danach `server.status`, `server.metrics`, `server.crashed`, `server.changed`, `install.state`, `install.progress`, `install.log` (mit `seq` und `time`), `java.install` (`major`, `state`, `phase`, `percent`, `message`), `backup.changed` und `mods.updates`. Der Zustand `preparing` kommt als `server.status`.

## Tests

`npm test` führt die Tests von Backend und Frontend aus. Neu sind u. a. Archive (Zip-Slip, Symlinks, Limits, Systemtar), die Java-Installation (gefälschtes Adoptium/GitHub, Plattformen, Abbruch, ein Download je Version), der Startablauf mit `preparing`, Mods an/aus samt Abhängigkeiten, Welt-Backups mit echten Dateien und dem Fake-Server (`save-off` / `save-all flush` / `save-on` auch nach Fehlern, Wiederherstellen mit Rückabwicklung), Zeitplan, Installationsprotokoll, Aufräumen der Update-Backups, Autostart, Konfigurationspfade und ein Upgrade-Test, der eine Datenbank im Stand der vorherigen Migration mit Daten auf den neuen Stand hebt. Das Frontend prüft API-Client, Konsolen-Logik (Wiederverbinden, Seq-Abgleich, Batching), Autoscroll, Assistent, RAM-Grenzen, den Löschablauf bei `MOD_REQUIRED_BY_OTHERS` und die 401-Behandlung. Die Backend-Tests laufen ohne Netzwerk und ohne Java: Ein echter `node`-Prozess (`packages/backend/test/fake-server.mjs`) ersetzt den Minecraft-Server, ein gefälschter Upstream (`fake-upstream.ts`) ersetzt Mojang, Fabric, Paper, NeoForge und Forge. Dazu kommen Tests der Paketierung (`node --test scripts/test/`, Teil von `npm test`): Zielsysteme, Prüfsummen (`SHASUMS256.txt`, npm-Integrität), Auswahl der Node-LTS, tar.gz- und ZIP-Archive mit Dateirechten, Erzeugung von Konfiguration und Token, Download-Beschränkung auf erlaubte Hosts, ELF-/PE-Kopf der nativen Bibliothek und Syntaxprüfung der Installationsskripte. Für das Selbst-Update kommen hinzu: Versionsvergleich (SemVer), Signatur und Hash (gültig, falscher Schlüssel, manipuliertes Paket, manipulierte Prüfsummen), Host-Liste und Weiterleitungen, Zustandsautomat, Anfrage-/Status-Protokoll, der gesamte Ablauf mit Countdown, Stoppen, Übergabe, Rückmeldung des Updaters und Neustart der Server, der privilegierte Updater (Prüfung, Rollback, Windows-Übergabe), Signier-Skript sowie Banner und Systemseite der Oberfläche. Für Netzwerk und Passwort kommen hinzu: Erkennung der Adressen mit gemeinsamen Testfällen für Anwendung und Installer (`scripts/test/lan-cases.json`), Rückfälle beim Binden, Validierung von Adresse/Port/Rechnernamen, Neustart mit Wiederstart der Server, scrypt-Hash, Passwortwechsel (falsches aktuelles Passwort, Sitzungen und Sockets ungültig, Ratenbegrenzung, Bearer-Token unberührt, Zurücksetzen von außen) und der Befehl `reset-password`. Nicht automatisch geprüft ist alles, was echtes Java, echte Installer oder einen echten Windows-/systemd-Dienst voraussetzt.

## Roadmap

1. **Phase 1** – Projekt, Datenbank-Schema, Basis-Webserver
2. **Phase 2** – Modrinth-Client und Mod-Verwaltung
3. **Phase 3** – Server-Installer, Prozessverwaltung, Live-Konsole, `server.properties`, Server-API, optionales Token
4. **Phase 4** – Weboberfläche
5. **Phase 5** – automatische Java-Installation, Mods an/aus, Welt-Backups, Installationsprotokoll, Backups der Updates, Autostart
6. **Phase 6** – Installationspakete: Windows-Installer mit Dienst (WinSW), Linux-Pakete mit systemd, GitHub-Workflows (dieser Stand)

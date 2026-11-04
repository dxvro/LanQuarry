# LocalMC CraftManager

Verwaltet mehrere Minecraft-Server-Instanzen auf einem Host und wird im lokalen Netzwerk (LAN) über den Browser bedient.

> **Sicherheitshinweis:** Die API kann Prozesse starten und Konsolenbefehle ausführen. Ohne `AUTH_TOKEN` (Standard, damit der Zugriff im LAN offen bleibt) hat **jeder**, der den Port erreichen kann, vollen Zugriff, und beim Start erscheint eine Warnung im Log. Nur in vertrauenswürdigen Netzwerken betreiben, niemals ins Internet freigeben. Für eine Anmeldung `AUTH_TOKEN` setzen (siehe unten).

Stand: **Phase 3** (Datenbank, Basis-Webserver, Modrinth-Mod-Verwaltung, Server-Installer, Prozessverwaltung, Live-Konsole per WebSocket, `server.properties`-Editor, Server-API, optionales Zugriffstoken). Es gibt noch keine Weboberfläche (Phase 4).

## Voraussetzungen

- Node.js 22 oder neuer (getestet mit 26) und npm
- Eine **Java-Installation** für den Betrieb der Minecraft-Server. Sie wird nicht mitgeliefert und nicht automatisch installiert. Welche Version ein Server braucht, steht in der Server-Antwort (`requiredJavaMajor`), z. B. Java 21 für Minecraft 1.21.1 und Java 25 für 26.x.
- Keine nativen Build-Tools nötig (SQLite läuft über `@libsql/client` mit vorkompilierten Binaries)

## Installation

```
npm install
```

## Entwicklung

```
npm run dev          # Backend mit automatischem Neustart (tsx watch)
npm run typecheck    # TypeScript-Prüfung inkl. Tests
npm test             # Tests (vitest, ohne Netzwerk und ohne Java)
npm run db:generate  # neue Migration aus src/db/schema.ts erzeugen
```

Migrationen liegen in `packages/backend/drizzle/` und werden beim Start automatisch ausgeführt. Bereits angewendete Migrationen werden nie verändert.

## Build und Start

```
npm run build
npm start
```

Prüfung: `http://localhost:3000/api/health`

Beenden mit Strg+C (bzw. `SIGINT`/`SIGTERM`/`SIGBREAK`/`SIGHUP`): Zuerst werden alle laufenden Minecraft-Server mit `stop` sauber gestoppt (Weltdaten werden gespeichert), erst nach Ablauf der Wartezeit werden übrig gebliebene Prozesse hart beendet. Danach schließen Webserver und Datenbank. Ein zweites Strg+C während des Herunterfahrens wird bewusst ignoriert.

## Konfiguration

Optional über Umgebungsvariablen oder eine `.env`-Datei im Projektstamm (Vorlage: `.env.example`).

| Variable               | Standard                         | Bedeutung                                                                                 |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `HOST`                 | `0.0.0.0`                        | Adresse, an die der Server bindet                                                         |
| `PORT`                 | `3000`                           | HTTP-Port                                                                                 |
| `DATA_DIR`             | `<Projekt>/data`                 | Datenbank und weitere Laufzeitdaten                                                       |
| `SERVERS_DIR`          | `<Projekt>/servers`              | Ordner der Minecraft-Server-Instanzen (`<SERVERS_DIR>/<Server-ID>/`)                      |
| `LOG_LEVEL`            | `info`                           | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                              |
| `MODRINTH_USER_AGENT`  | `LocalMC-CraftManager/<Version>` | User-Agent für Modrinth- und Loader-Anfragen (keine persönlichen Daten eintragen)        |
| `AUTH_TOKEN`           | (leer = keine Anmeldung)         | Zugriffstoken, mindestens 8 Zeichen. Aktiviert die Anmeldung für die gesamte API         |
| `ALLOWED_ORIGINS`      | (leer)                           | Kommagetrennte zusätzliche Origins, z. B. `http://localhost:5173` für den Vite-Dev-Proxy |
| `ALLOWED_HOSTS`        | (leer)                           | Kommagetrennte zusätzliche Host-Namen ohne Port, z. B. `craft.example.lan` (siehe Sicherheit) |
| `STOP_TIMEOUT_SECONDS` | `120`                            | Wartezeit nach `stop`, bevor ein Server hart beendet wird (5 bis 3600); bei großen Welten nicht zu knapp wählen, sonst können beim Speichern Daten verloren gehen |

Die Ordner `data/` und `servers/` werden beim Start angelegt und sind nicht Teil des Repositories.

## Zugriff aus dem LAN

Beim Start werden die erreichbaren Adressen ausgegeben, z. B. `http://192.168.1.20:3000`. Auch `/api/health` listet sie unter `lanUrls` (nur mit Anmeldung bzw. ohne `AUTH_TOKEN`).

Falls andere Geräte die Seite nicht erreichen, blockiert vermutlich die Windows-Firewall den Port. Regel in einer Administrator-PowerShell anlegen (Port ggf. anpassen):

```
New-NetFirewallRule -DisplayName "LocalMC CraftManager" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

Ist der Port bereits belegt, bricht der Start mit einer Meldung ab. Dann `PORT` in der `.env` ändern. Für die Minecraft-Server selbst muss der jeweilige Server-Port (Standard 25565) ebenfalls freigegeben werden.

## Sicherheit

- **Host-Prüfung (DNS-Rebinding):** Jede Anfrage, auch `GET` und WebSocket-Aufbau, braucht einen `Host`-Header mit einer IP-Adresse (IPv4/IPv6), `localhost`, `*.localhost`, dem Rechnernamen (ohne Beachtung der Groß-/Kleinschreibung, auch mit `.local`, `.lan`, `.home`, `.home.arpa` oder `.fritz.box`) oder einem Eintrag aus `ALLOWED_HOSTS`. Sonst antwortet die API mit `403 HOST_FORBIDDEN`, ebenso bei fehlendem `Host`. Das verhindert, dass eine Webseite mit umgebogener DNS-Auflösung die API im Browser eines LAN-Nutzers ansteuert. Der Vite-Dev-Proxy über `localhost` ist erlaubt. Wer die Oberfläche unter einem eigenen Namen erreicht, trägt ihn in `ALLOWED_HOSTS` ein.
- **Origin-Prüfung:** Bei allen Anfragen außer `GET`/`HEAD` und bei jedem WebSocket-Aufbau muss ein vorhandener `Origin`-Header zum `Host` der Anfrage passen, sonst `403 ORIGIN_FORBIDDEN`. Das verhindert, dass eine fremde Webseite im Browser eines LAN-Nutzers den Server steuert. Anfragen ohne `Origin` (curl, Skripte) sind erlaubt. Für den Vite-Dev-Proxy der Phase 4 die Entwicklungsadresse in `ALLOWED_ORIGINS` eintragen.
- **Anmeldung (optional):** Mit `AUTH_TOKEN` verlangt jede Route außer `GET /api/health`, `GET /api/auth/status`, `POST /api/auth/login` und `POST /api/auth/logout` eine Anmeldung per `Authorization: Bearer <Token>` oder per HttpOnly/SameSite=Strict-Cookie. Das Cookie setzt `POST /api/auth/login` mit `{ "token": "..." }`, `POST /api/auth/logout` löscht es. WebSockets nutzen dasselbe Cookie oder den Bearer-Header. Das Token wird zeitkonstant verglichen. Nach 5 falschen Anmeldungen innerhalb von 5 Minuten wird die IP-Adresse mit `429 TOO_MANY_ATTEMPTS` gesperrt. Ohne HTTPS wird das Token im LAN unverschlüsselt übertragen; die Anmeldung schützt vor Zufallszugriffen, nicht vor Mitlesern im Netz. `/api/health` liefert ohne Anmeldung nur `status` und `database`.
- Der Java-Pfad eines Servers muss auf eine Datei namens `java` bzw. `java.exe` zeigen und `-version` beantworten (`422 JAVA_INVALID`), wird aber ausgeführt. Wer die API erreicht, kann damit Programme starten; deshalb bei Bedarf `AUTH_TOKEN` setzen.

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

`GET /api/system` listet gefundene Java-Installationen (`JAVA_HOME`, `PATH`, `Program Files\Java`, Eclipse Adoptium, Microsoft, Zulu, BellSoft, Amazon Corretto, Semeru, `/usr/lib/jvm`, `/Library/Java/JavaVirtualMachines`) mit Hauptversion. `?rescan=true` erzwingt eine neue Suche; sonst gilt ein kurzer Zwischenspeicher. Ohne eingestellten `javaPath` wird die niedrigste passende Version gewählt.

## API

Fehler haben immer die Form `{ "error": { "code", "message", "details?" } }`. Bodylose `POST`-Anfragen sind auch mit `Content-Type: application/json` erlaubt.

System und Loader:

- `GET /api/health` – Status, Version, Laufzeit, Datenbank, LAN-Adressen
- `GET /api/system?rescan` – Arbeitsspeicher, CPU-Anzahl, Plattform, Java-Installationen
- `GET /api/loaders` – verfügbare Loader
- `GET /api/loaders/:loader/mc-versions?snapshots=true` – Minecraft-Versionen des Loaders
- `GET /api/loaders/:loader/versions?mcVersion=` – Loader-Versionen (mit `stable` und `recommended`)

Server:

- `GET /api/servers`, `GET /api/servers/:id` – Server mit Laufzeitstatus (`status`: Zustand, PID, Spieler, CPU in Prozent der gesamten Maschine, Arbeitsspeicher)
- `POST /api/servers` mit `{ name, loader, mcVersion, loaderVersion?, port?, minRamMb?, maxRamMb?, eulaAccepted? }`
- `PATCH /api/servers/:id` mit `{ name, minRamMb, maxRamMb, javaPath, useAikarFlags, extraJvmArgs, eulaAccepted }` (alle optional; Antwort enthält `restartRequired`)
- `DELETE /api/servers/:id?confirm=true` – nicht bei laufendem Server oder laufender Installation; entfernt nur `<SERVERS_DIR>/<UUID>`
- `POST /api/servers/:id/install | start | stop | restart | kill`
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

Installieren, Aktualisieren und Löschen von Mods sind bei laufendem Server gesperrt (`409 SERVER_RUNNING`). Start, Installation, Löschen und Mod-Änderungen eines Servers teilen sich eine Sperre und laufen nie gleichzeitig.

Authentifizierung: `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout`.

### WebSockets

Beide Endpunkte senden JSON-Nachrichten. Langsame Clients (mehr als 1 MiB unversendete Daten) werden getrennt.

- `ws://<Host>/api/servers/:id/console?history=1000` – beim Verbinden `{type:"status",status}` und `{type:"history",lines}`, danach `{type:"line",line}` und `{type:"status",status}`. Der Client sendet `{type:"command",command,id?}` und erhält `{type:"ack",id?}` oder `{type:"error",code,message,id?}`; auch `{type:"ping"}` wird beantwortet. Fehler und ungültiges JSON schließen die Verbindung nicht. Eine Zeile hat `seq`, `time`, `stream` (`stdout`, `stderr`, `system`, `input`) und `text`.
- `ws://<Host>/api/events` – zuerst `{type:"snapshot",servers}`, danach `server.status`, `server.metrics`, `server.crashed`, `server.changed`, `install.state`, `install.progress`, `install.log` und `mods.updates`.

## Tests

`npm test` läuft ohne Netzwerk und ohne Java: Ein echter `node`-Prozess (`packages/backend/test/fake-server.mjs`) ersetzt den Minecraft-Server, ein gefälschter Upstream (`fake-upstream.ts`) ersetzt Mojang, Fabric, Paper, NeoForge und Forge. Nicht automatisch geprüft ist alles, was echtes Java oder echte Installer voraussetzt.

## Roadmap

1. **Phase 1** – Projekt, Datenbank-Schema, Basis-Webserver
2. **Phase 2** – Modrinth-Client und Mod-Verwaltung
3. **Phase 3** – Server-Installer, Prozessverwaltung, Live-Konsole, `server.properties`, Server-API, optionales Token (dieser Stand)
4. **Phase 4** – Weboberfläche

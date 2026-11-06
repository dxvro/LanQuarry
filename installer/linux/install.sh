#!/usr/bin/env bash
# LocalMC CraftManager - Installation und Update (Linux mit systemd)
#
#   sudo ./install.sh [--port 3000] [--open-firewall] [--no-start] [--upgrade]
#
# Installiert nach /opt/craftmanager, Daten nach /var/lib/craftmanager, Konfiguration nach
# /etc/craftmanager/craftmanager.env. Ein erneuter Aufruf mit einer neueren Version ist ein Update:
# Daten und Konfiguration bleiben unverändert.
set -euo pipefail

INSTALL_DIR=/opt/craftmanager
DATA_DIR=/var/lib/craftmanager
CONF_DIR=/etc/craftmanager
CONF_FILE="$CONF_DIR/craftmanager.env"
FIREWALL_STATE="$CONF_DIR/firewall.state"
UPDATE_ROOT=/var/lib/craftmanager-update
UNIT_FILE=/etc/systemd/system/craftmanager.service
UPDATE_UNIT_FILE=/etc/systemd/system/craftmanager-update.service
UPDATE_PATH_FILE=/etc/systemd/system/craftmanager-update.path
CLI_LINK=/usr/local/bin/craftmanager
SERVICE_USER=craftmanager
MC_PORT_RANGE_DASH="25565-25575"
MC_PORT_RANGE_COLON="25565:25575"

PORT=3000
OPEN_FIREWALL=0
START_SERVICE=1
UPGRADE=0

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
LocalMC CraftManager installieren oder aktualisieren

  sudo ./install.sh [Optionen]

  --port <Port>      Web-Port bei der Erstinstallation (Standard 3000). Bei einem Update bleibt die Konfiguration erhalten.
  --open-firewall    Web-Port und Minecraft-Ports (TCP 25565-25575) in ufw bzw. firewalld freigeben
  --no-start         Dienst einrichten, aber nicht starten
  --upgrade          Update einer vorhandenen Installation (vom Update-Dienst genutzt): ohne Port, Firewall und Zugangsdaten
  -h, --help         diese Hilfe
EOF
}

info() { printf '%s\n' "$*"; }
warn() { printf 'Hinweis: %s\n' "$*" >&2; }
die() { printf 'Fehler: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --port)
      [ "$#" -ge 2 ] || die "Zu --port fehlt ein Wert."
      PORT="$2"
      shift 2
      ;;
    --port=*)
      PORT="${1#--port=}"
      shift
      ;;
    --open-firewall)
      OPEN_FIREWALL=1
      shift
      ;;
    --no-start)
      START_SERVICE=0
      shift
      ;;
    --upgrade)
      UPGRADE=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "Unbekannte Option: $1"
      ;;
  esac
done

case "$PORT" in
  '' | *[!0-9]*) die "Ungültiger Port: $PORT" ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then die "Ungültiger Port: $PORT"; fi

[ "$(id -u)" -eq 0 ] || die "Bitte als root ausführen, z. B. mit: sudo ./install.sh"
[ "$(uname -s)" = "Linux" ] || die "Dieses Paket ist nur für Linux."
command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] ||
  die "systemd wird benötigt (systemctl nicht gefunden oder nicht aktiv). Alternative: Anwendung von Hand mit node/node app/backend/dist/index.js starten."
for required in node/node app/backend/dist/index.js app/frontend/dist/index.html tools/setup-config.mjs tools/lan.mjs tools/updater.mjs tools/update-keys.json craftmanager craftmanager.service craftmanager-update.service craftmanager-update.path version.json; do
  [ -e "$SRC/$required" ] || die "Das Paket ist unvollständig ($required fehlt). Archiv neu entpacken."
done

# Passt das Paket zur Prozessorarchitektur?
package_target="$(sed -n 's/.*"target": *"\([^"]*\)".*/\1/p' "$SRC/version.json" | head -n 1)"
case "$(uname -m)" in
  x86_64 | amd64) machine_target=linux-x64 ;;
  aarch64 | arm64) machine_target=linux-arm64 ;;
  *) machine_target="unbekannt ($(uname -m))" ;;
esac
[ "$package_target" = "$machine_target" ] ||
  die "Dieses Paket ist für $package_target, der Rechner ist $machine_target. Bitte das passende Archiv verwenden."
"$SRC/node/node" --version >/dev/null 2>&1 ||
  die "Die mitgelieferte Node-Programmdatei lässt sich nicht starten (glibc-basiertes Linux erforderlich, z. B. Debian, Ubuntu, Fedora; Alpine wird nicht unterstützt)."

if [ "$UPGRADE" -eq 1 ]; then
  [ "$OPEN_FIREWALL" -eq 0 ] || die "--upgrade lässt sich nicht mit --open-firewall kombinieren."
  [ -f "$INSTALL_DIR/VERSION" ] || die "--upgrade ist nur für eine vorhandene Installation gedacht."
  [ -f "$CONF_FILE" ] || die "--upgrade: Die Konfiguration $CONF_FILE fehlt."
fi

new_version="$(tr -d '\r\n' <"$SRC/VERSION")"
old_version=""
[ -f "$INSTALL_DIR/VERSION" ] && old_version="$(tr -d '\r\n' <"$INSTALL_DIR/VERSION")"
if [ -n "$old_version" ]; then
  info "Aktualisiere LocalMC CraftManager $old_version -> $new_version ..."
else
  info "Installiere LocalMC CraftManager $new_version ..."
fi

# Systembenutzer ohne Anmeldung
if ! getent group "$SERVICE_USER" >/dev/null 2>&1; then
  groupadd --system "$SERVICE_USER"
fi
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  nologin="$(command -v nologin || true)"
  [ -n "$nologin" ] || nologin=/usr/sbin/nologin
  useradd --system --gid "$SERVICE_USER" --home-dir "$DATA_DIR" --no-create-home --shell "$nologin" \
    --comment "LocalMC CraftManager" "$SERVICE_USER"
  info "Systembenutzer $SERVICE_USER angelegt."
fi

# Laufenden Dienst anhalten (wartet, bis die Minecraft-Server gespeichert und beendet sind)
was_active=0
if systemctl is-active --quiet craftmanager.service; then
  was_active=1
  info "Stoppe den laufenden Dienst (Minecraft-Server werden sauber beendet, das kann bis zu drei Minuten dauern) ..."
  systemctl stop craftmanager.service
fi

install -d -o root -g root -m 0755 /opt
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$DATA_DIR"
install -d -o root -g "$SERVICE_USER" -m 0750 "$CONF_DIR"
# Ordner des Updaters: root-eigen (status.json, Arbeits- und Sicherungsordner); nur request/ darf die Anwendung beschreiben
install -d -o root -g root -m 0755 "$UPDATE_ROOT"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$UPDATE_ROOT/request"
install -d -o root -g root -m 0700 "$UPDATE_ROOT/work" "$UPDATE_ROOT/backup"

# Programmdateien: erst in einen neuen Ordner kopieren, dann austauschen (kein halbes Update bei Abbruch)
staging="$INSTALL_DIR.new"
rm -rf "$staging" "$INSTALL_DIR.old"
mkdir -p "$staging"
cp -R "$SRC/node" "$SRC/app" "$SRC/tools" "$staging/"
for file in VERSION version.json LICENSE.txt THIRD-PARTY-NOTICES.txt LIESMICH.txt uninstall.sh craftmanager craftmanager.service craftmanager-update.service craftmanager-update.path; do
  [ -f "$SRC/$file" ] && cp "$SRC/$file" "$staging/$file"
done
chown -R root:root "$staging"
chmod -R go-w "$staging"
chmod 0755 "$staging/node/node"
[ -f "$staging/uninstall.sh" ] && chmod 0755 "$staging/uninstall.sh"
chmod 0755 "$staging/craftmanager"
if [ -d "$INSTALL_DIR" ]; then mv "$INSTALL_DIR" "$INSTALL_DIR.old"; fi
mv "$staging" "$INSTALL_DIR"
rm -rf "$INSTALL_DIR.old"

# Konfiguration nur bei der Erstinstallation anlegen
created=0
token=""
if [ ! -f "$CONF_FILE" ]; then
  output="$("$INSTALL_DIR/node/node" "$INSTALL_DIR/tools/setup-config.mjs" \
    --config "$CONF_FILE" --data-dir "$DATA_DIR" --servers-dir "$DATA_DIR/servers" --port "$PORT" --print-token)"
  case "$output" in
    *'"created":true'*) created=1 ;;
    *) die "Die Konfiguration konnte nicht angelegt werden." ;;
  esac
  token="$(printf '%s' "$output" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  [ -n "$token" ] || die "Das Zugriffstoken konnte nicht erzeugt werden."
elif [ "$PORT" != "3000" ]; then
  warn "Die Konfiguration $CONF_FILE existiert bereits; --port wird ignoriert. Port dort ändern (PORT=...)."
fi
chown root:"$SERVICE_USER" "$CONF_FILE"
chmod 0640 "$CONF_FILE"

# Verwaltungsbefehl "sudo craftmanager reset-password" (ein fremder Eintrag gleichen Namens bleibt unberührt)
if [ ! -e "$CLI_LINK" ] && [ ! -L "$CLI_LINK" ] || [ "$(readlink "$CLI_LINK" 2>/dev/null)" = "$INSTALL_DIR/craftmanager" ]; then
  install -d -m 0755 "$(dirname "$CLI_LINK")"
  ln -sfn "$INSTALL_DIR/craftmanager" "$CLI_LINK"
else
  warn "$CLI_LINK existiert bereits und wurde nicht ersetzt. Der Befehl ist auch über $INSTALL_DIR/craftmanager erreichbar."
fi

# Dienst einrichten
install -m 0644 -o root -g root "$INSTALL_DIR/craftmanager.service" "$UNIT_FILE"
install -m 0644 -o root -g root "$INSTALL_DIR/craftmanager-update.service" "$UPDATE_UNIT_FILE"
install -m 0644 -o root -g root "$INSTALL_DIR/craftmanager-update.path" "$UPDATE_PATH_FILE"
systemctl daemon-reload
systemctl enable craftmanager.service >/dev/null 2>&1
# Der Pfad-Auslöser läuft schon, wenn dieses Skript vom Updater selbst gestartet wurde: nicht neu starten
systemctl enable craftmanager-update.path >/dev/null 2>&1
systemctl start craftmanager-update.path >/dev/null 2>&1 || warn "Der Update-Auslöser craftmanager-update.path ließ sich nicht starten."

configured_port="$(sed -n "s/^PORT=['\"]\{0,1\}\([0-9]\{1,5\}\).*/\1/p" "$CONF_FILE" | head -n 1)"
[ -n "$configured_port" ] || configured_port=3000

if [ "$START_SERVICE" -eq 1 ]; then
  systemctl restart craftmanager.service
  healthy=0
  for _ in $(seq 1 30); do
    # Port und Adresse können in der Weboberfläche geändert worden sein: tools/lan.mjs --probe liest network.json
    probe_url="$("$INSTALL_DIR/node/node" "$INSTALL_DIR/tools/lan.mjs" --probe --data-dir "$DATA_DIR" --config "$CONF_FILE" 2>/dev/null || true)"
    [ -n "$probe_url" ] || probe_url="http://127.0.0.1:$configured_port"
    if "$INSTALL_DIR/node/node" -e "fetch('$probe_url/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
      healthy=1
      break
    fi
    sleep 1
  done
  if [ "$healthy" -eq 1 ]; then
    info "Dienst läuft."
  else
    warn "Der Dienst antwortet noch nicht. Protokoll ansehen mit: journalctl -u craftmanager -e"
  fi
elif [ "$was_active" -eq 1 ]; then
  warn "Der Dienst war aktiv und bleibt wegen --no-start gestoppt: sudo systemctl start craftmanager"
fi

# Firewall (optional)
firewall_note=""
if [ "$OPEN_FIREWALL" -eq 1 ] && [ "$UPGRADE" -eq 0 ]; then
  : >"$FIREWALL_STATE.tmp"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow "$configured_port/tcp" comment 'LocalMC CraftManager Web' >/dev/null
    ufw allow "$MC_PORT_RANGE_COLON/tcp" comment 'LocalMC CraftManager Minecraft' >/dev/null
    printf 'ufw %s/tcp\nufw %s/tcp\n' "$configured_port" "$MC_PORT_RANGE_COLON" >>"$FIREWALL_STATE.tmp"
    firewall_note="ufw: TCP $configured_port und $MC_PORT_RANGE_DASH freigegeben."
  elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port="$configured_port/tcp" >/dev/null
    firewall-cmd --permanent --add-port="$MC_PORT_RANGE_DASH/tcp" >/dev/null
    firewall-cmd --reload >/dev/null
    printf 'firewalld %s/tcp\nfirewalld %s/tcp\n' "$configured_port" "$MC_PORT_RANGE_DASH" >>"$FIREWALL_STATE.tmp"
    firewall_note="firewalld: TCP $configured_port und $MC_PORT_RANGE_DASH freigegeben."
  else
    firewall_note="Keine aktive Firewall (ufw/firewalld) gefunden, nichts geändert."
  fi
  if [ -s "$FIREWALL_STATE.tmp" ]; then
    # frühere Einträge behalten, Dopplungen vermeiden
    { [ -f "$FIREWALL_STATE" ] && cat "$FIREWALL_STATE"; cat "$FIREWALL_STATE.tmp"; } | sort -u >"$FIREWALL_STATE.new"
    mv "$FIREWALL_STATE.new" "$FIREWALL_STATE"
    chown root:root "$FIREWALL_STATE"
    chmod 0644 "$FIREWALL_STATE"
  fi
  rm -f "$FIREWALL_STATE.tmp"
fi

# Adressen: nur Adapter mit privaten Adressen zuerst, virtuelle Adapter (Docker, VPN, WSL, ...) getrennt;
# der Port ist der, auf dem die Anwendung wirklich lauscht (in der Weboberfläche änderbar)
web_port="$configured_port"
probe_url="$("$INSTALL_DIR/node/node" "$INSTALL_DIR/tools/lan.mjs" --probe --data-dir "$DATA_DIR" --config "$CONF_FILE" 2>/dev/null || true)"
[ -n "$probe_url" ] && web_port="${probe_url##*:}"
lan_text="$("$INSTALL_DIR/node/node" "$INSTALL_DIR/tools/lan.mjs" --text --data-dir "$DATA_DIR" --config "$CONF_FILE" 2>/dev/null | tr -d '\r' || true)"
if [ -z "$lan_text" ]; then
  # ohne Ausgabe von Node: hostname -I, nur IPv4 und ohne Link-Local-Adressen (169.254/16)
  lan_text="   http://localhost:$web_port"
  for address in $(hostname -I 2>/dev/null || true); do
    case "$address" in
      *:* | 169.254.*) ;;
      *) lan_text="   http://$address:$web_port
$lan_text" ;;
    esac
  done
fi

info ""
info "=============================================================="
if [ "$created" -eq 1 ]; then
  info " LocalMC CraftManager $new_version ist installiert."
else
  info " LocalMC CraftManager ist auf $new_version aktualisiert."
fi
info "=============================================================="
info " Weboberfläche erreichbar unter:"
info "$lan_text"
info " (Adresse im Router fest vergeben, damit sie sich nicht ändert: FritzBox unter Heimnetz > Netzwerk > Gerät bearbeiten)"
if [ "$created" -eq 1 ]; then
  info ""
  info " Zugriffstoken (zum Anmelden, zugleich das erste Passwort):"
  info "   $token"
  info ""
  info " Das Token steht auch in $CONF_FILE (nur root und Gruppe $SERVICE_USER lesbar):"
  info "   sudo grep AUTH_TOKEN $CONF_FILE"
  info " Ein eigenes Passwort lässt sich in der Weboberfläche unter System festlegen."
  info " Passwort vergessen:  sudo craftmanager reset-password"
fi
info ""
info " Daten und Server:  $DATA_DIR"
info " Konfiguration:     $CONF_FILE"
info " Protokoll:         journalctl -u craftmanager -f"
info " Ports:             Web TCP $web_port, Minecraft TCP $MC_PORT_RANGE_DASH (je nach Server)"
[ -n "$firewall_note" ] && info " Firewall:          $firewall_note"
if [ "$OPEN_FIREWALL" -eq 0 ] && [ "$UPGRADE" -eq 0 ]; then
  info " Firewall:          nicht verändert (Option --open-firewall oder Ports von Hand freigeben)"
fi
info ""
info " Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden."
info "=============================================================="

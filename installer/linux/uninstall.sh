#!/usr/bin/env bash
# LocalMC CraftManager - Deinstallation (Linux mit systemd)
#
#   sudo ./uninstall.sh [--purge] [--yes]
#
# Ohne --purge bleiben Daten (/var/lib/craftmanager) und Konfiguration (/etc/craftmanager) erhalten,
# damit eine spätere Neuinstallation sofort wieder alle Server findet.
set -euo pipefail

INSTALL_DIR=/opt/craftmanager
DATA_DIR=/var/lib/craftmanager
CONF_DIR=/etc/craftmanager
FIREWALL_STATE="$CONF_DIR/firewall.state"
UNIT_FILE=/etc/systemd/system/craftmanager.service
UPDATE_UNIT_FILE=/etc/systemd/system/craftmanager-update.service
UPDATE_PATH_FILE=/etc/systemd/system/craftmanager-update.path
UPDATE_ROOT=/var/lib/craftmanager-update
SERVICE_USER=craftmanager

PURGE=0
ASSUME_YES=0

info() { printf '%s\n' "$*"; }
warn() { printf 'Hinweis: %s\n' "$*" >&2; }
die() { printf 'Fehler: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
LocalMC CraftManager deinstallieren

  sudo ./uninstall.sh [Optionen]

  --purge    zusätzlich ALLE Daten löschen: Server, Welten, Backups, Datenbank, Konfiguration, Systembenutzer
  --yes      Rückfrage bei --purge überspringen
  -h, --help diese Hilfe
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "Unbekannte Option: $1"
      ;;
  esac
  shift
done

[ "$(id -u)" -eq 0 ] || die "Bitte als root ausführen, z. B. mit: sudo ./uninstall.sh"

if [ "$PURGE" -eq 1 ] && [ "$ASSUME_YES" -eq 0 ]; then
  info "ACHTUNG: --purge löscht unwiderruflich alle Minecraft-Server, Welten und Backups in $DATA_DIR"
  info "sowie die Konfiguration in $CONF_DIR."
  printf 'Zum Bestätigen "ja" eingeben: '
  read -r answer || answer=""
  [ "$answer" = "ja" ] || die "Abgebrochen, es wurde nichts gelöscht."
fi

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  if systemctl is-active --quiet craftmanager.service; then
    info "Stoppe den Dienst (Minecraft-Server werden sauber beendet, das kann bis zu drei Minuten dauern) ..."
    systemctl stop craftmanager.service || warn "Der Dienst ließ sich nicht sauber stoppen."
  fi
  systemctl disable craftmanager.service >/dev/null 2>&1 || true
  systemctl disable --now craftmanager-update.path >/dev/null 2>&1 || true
  systemctl stop craftmanager-update.service >/dev/null 2>&1 || true
  rm -f "$UNIT_FILE" "$UPDATE_UNIT_FILE" "$UPDATE_PATH_FILE"
  systemctl daemon-reload || true
  systemctl reset-failed craftmanager.service >/dev/null 2>&1 || true
fi

# Firewall-Regeln entfernen, die install.sh --open-firewall angelegt hat
if [ -f "$FIREWALL_STATE" ]; then
  while read -r tool rule; do
    [ -n "$tool" ] || continue
    case "$tool" in
      ufw)
        command -v ufw >/dev/null 2>&1 && ufw delete allow "$rule" >/dev/null 2>&1 || true
        ;;
      firewalld)
        if command -v firewall-cmd >/dev/null 2>&1; then
          firewall-cmd --permanent --remove-port="$rule" >/dev/null 2>&1 || true
        fi
        ;;
    esac
  done <"$FIREWALL_STATE"
  command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1 || true
  rm -f "$FIREWALL_STATE"
  info "Firewall-Regeln von CraftManager entfernt."
fi

# Verwaltungsbefehl nur entfernen, wenn er auf diese Installation zeigt
if [ "$(readlink /usr/local/bin/craftmanager 2>/dev/null)" = "$INSTALL_DIR/craftmanager" ]; then rm -f /usr/local/bin/craftmanager; fi
rm -rf "$INSTALL_DIR" "$INSTALL_DIR.new" "$INSTALL_DIR.old" "$UPDATE_ROOT"
info "Programmdateien entfernt ($INSTALL_DIR)."

if [ "$PURGE" -eq 1 ]; then
  rm -rf "$DATA_DIR" "$CONF_DIR"
  if id -u "$SERVICE_USER" >/dev/null 2>&1; then userdel "$SERVICE_USER" >/dev/null 2>&1 || true; fi
  if getent group "$SERVICE_USER" >/dev/null 2>&1; then groupdel "$SERVICE_USER" >/dev/null 2>&1 || true; fi
  info "Daten, Konfiguration und Systembenutzer gelöscht."
else
  info ""
  info "Behalten wurden:"
  info "  Daten und Server:  $DATA_DIR"
  info "  Konfiguration:     $CONF_DIR"
  info "  Systembenutzer:    $SERVICE_USER"
  info "Alles entfernen mit: sudo ./uninstall.sh --purge"
fi

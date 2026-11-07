#!/usr/bin/env bash
# MCraftManager - uninstall (Linux with systemd)
#
#   sudo ./uninstall.sh [--purge] [--yes]
#
# Without --purge, data (/var/lib/craftmanager) and configuration (/etc/craftmanager) are kept,
# so a later reinstallation finds all servers again right away.
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
warn() { printf 'Note: %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Uninstall MCraftManager

  sudo ./uninstall.sh [options]

  --purge    also delete ALL data: servers, worlds, backups, database, configuration, system user
  --yes      skip the confirmation question of --purge
  -h, --help this help
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
      die "Unknown option: $1"
      ;;
  esac
  shift
done

[ "$(id -u)" -eq 0 ] || die "Please run as root, for example: sudo ./uninstall.sh"

if [ "$PURGE" -eq 1 ] && [ "$ASSUME_YES" -eq 0 ]; then
  info "WARNING: --purge irreversibly deletes all Minecraft servers, worlds and backups in $DATA_DIR"
  info "as well as the configuration in $CONF_DIR."
  printf 'Type "yes" to confirm: '
  read -r answer || answer=""
  [ "$answer" = "yes" ] || [ "$answer" = "ja" ] || die "Aborted, nothing was deleted."
fi

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  if systemctl is-active --quiet craftmanager.service; then
    info "Stopping the service (Minecraft servers are shut down cleanly, this can take up to three minutes) ..."
    systemctl stop craftmanager.service || warn "The service could not be stopped cleanly."
  fi
  systemctl disable craftmanager.service >/dev/null 2>&1 || true
  systemctl disable --now craftmanager-update.path >/dev/null 2>&1 || true
  systemctl stop craftmanager-update.service >/dev/null 2>&1 || true
  rm -f "$UNIT_FILE" "$UPDATE_UNIT_FILE" "$UPDATE_PATH_FILE"
  systemctl daemon-reload || true
  systemctl reset-failed craftmanager.service >/dev/null 2>&1 || true
fi

# Remove the firewall rules created by install.sh --open-firewall
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
  info "MCraftManager firewall rules removed."
fi

# Remove the admin command only if it points to this installation
if [ "$(readlink /usr/local/bin/craftmanager 2>/dev/null)" = "$INSTALL_DIR/craftmanager" ]; then rm -f /usr/local/bin/craftmanager; fi
rm -rf "$INSTALL_DIR" "$INSTALL_DIR.new" "$INSTALL_DIR.old" "$UPDATE_ROOT"
info "Program files removed ($INSTALL_DIR)."

if [ "$PURGE" -eq 1 ]; then
  rm -rf "$DATA_DIR" "$CONF_DIR"
  if id -u "$SERVICE_USER" >/dev/null 2>&1; then userdel "$SERVICE_USER" >/dev/null 2>&1 || true; fi
  if getent group "$SERVICE_USER" >/dev/null 2>&1; then groupdel "$SERVICE_USER" >/dev/null 2>&1 || true; fi
  info "Data, configuration and system user deleted."
else
  info ""
  info "Kept:"
  info "  Data and servers:  $DATA_DIR"
  info "  Configuration:     $CONF_DIR"
  info "  System user:       $SERVICE_USER"
  info "Remove everything with: sudo ./uninstall.sh --purge"
fi

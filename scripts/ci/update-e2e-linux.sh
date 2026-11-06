#!/usr/bin/env bash
# End-to-end update test on the Ubuntu VM of the runner (systemd, root).
#
# Flow: install a test package 0.x.y, start a fake GitHub with signed test releases and trigger the update through the
# web interface API. Checked: success, rejection of a tampered package, rejection of a forged request by the root
# updater itself, folder permissions and the rollback on a broken version.
#
# The test packages carry a marker (tools/update-test.json) that is only built in this CI. It allows the local
# update source and the throwaway key; packages from release.yml have neither.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$PWD"
WORK="$(mktemp -d)"
API_PORT=4599
APP_PORT=3917
API="http://127.0.0.1:$API_PORT"
BASE="http://127.0.0.1:$APP_PORT"
KEY="$WORK/ci-private.pem"
PUB="$WORK/ci-public.pem"
REPO="ci/test"
GH="$WORK/gh"
FAKE_PID=""

log() { printf '\n=== %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

dump() {
  printf '\n--- Diagnostics ---\n'
  sudo journalctl -u craftmanager -u craftmanager-update --no-pager -n 120 2>/dev/null || true
  sudo cat /var/lib/craftmanager-update/status.json 2>/dev/null || true
  sudo tail -n 60 /var/lib/craftmanager-update/updater.log 2>/dev/null || true
  ls -la /var/lib/craftmanager-update /var/lib/craftmanager-update/request 2>/dev/null || true
}
cleanup() {
  code=$?
  [ "$code" -eq 0 ] || dump
  [ -z "$FAKE_PID" ] || kill "$FAKE_PID" 2>/dev/null || true
  sudo /opt/craftmanager/uninstall.sh --purge --yes >/dev/null 2>&1 || true
  exit "$code"
}
trap cleanup EXIT

TOKEN=""
call() { curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }
state() { call "$BASE/api/system/update"; }
wait_for() { # <description> <seconds> <command ...>
  local what="$1" seconds="$2"
  shift 2
  for _ in $(seq 1 "$seconds"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  fail "Timeout: $what"
}
health_version() { curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/health" | jq -er '.version'; }
is_version() { [ "$(health_version 2>/dev/null)" = "$1" ]; }
phase_is() { [ "$(state | jq -r '.phase')" = "$1" ]; }
history_is() { [ "$(state | jq -r '.history[0].result')" = "$1" ]; }

VERSION="$(node -p "require('./packages/backend/package.json').version")"
bump() { node -e "const [a,b,c]=process.argv[1].split('.');console.log(a+'.'+b+'.'+(Number(c)+Number(process.argv[2])))" "$VERSION" "$1"; }
NEXT="$(bump 1)"
BROKEN="$(bump 2)"
EVIL="$(bump 3)"

log "Building the throwaway key and test packages ($VERSION, $NEXT, $BROKEN)"
node scripts/update-keygen.mjs --out "$KEY" --pub-out "$PUB" >/dev/null
build() { # <version> <output> [--no-archive]
  node scripts/package.mjs --target linux-x64 --skip-build --skip-smoke --out "$WORK/$2" --version-override "$1" \
    --test-update-api "$API" --test-update-key "$PUB" "${@:3}" >/dev/null
}
build "$VERSION" pkg-a
build "$NEXT" pkg-b
build "$BROKEN" pkg-c --no-archive
test -f "$WORK/pkg-a/linux-x64/tools/update-test.json"

# Version "broken": the application does not start (the service fails, the health check fails)
mkdir -p "$WORK/broken"
cp -a "$WORK/pkg-c/linux-x64" "$WORK/broken/craftmanager-$BROKEN-linux-x64"
printf '\nthrow new Error("CI: deliberately broken version");\n' >>"$WORK/broken/craftmanager-$BROKEN-linux-x64/app/backend/dist/index.js"
tar -czf "$WORK/craftmanager-$BROKEN-linux-x64.tar.gz" -C "$WORK/broken" "craftmanager-$BROKEN-linux-x64"

release() { # <version> <package file>
  mkdir -p "$GH/v$1"
  cp "$2" "$GH/v$1/"
  node scripts/ci/release-fixture.mjs --dir "$GH/v$1" --key "$KEY" --pub "$PUB"
}
mkdir -p "$GH"
node scripts/ci/fake-github.mjs --dir "$GH" --port "$API_PORT" --repo "$REPO" >"$WORK/fake-github.log" 2>&1 &
FAKE_PID=$!

log "Installation of $VERSION"
mkdir -p "$WORK/extract-a"
tar -xzf "$WORK/pkg-a/craftmanager-$VERSION-linux-x64.tar.gz" -C "$WORK/extract-a"
sudo "$WORK/extract-a/craftmanager-$VERSION-linux-x64/install.sh" --port "$APP_PORT"
printf "UPDATE_REPO='%s'\nUPDATE_API_BASE='%s'\n" "$REPO" "$API" | sudo tee -a /etc/craftmanager/craftmanager.env >/dev/null
sudo systemctl restart craftmanager
TOKEN="$(sudo sed -n "s/^AUTH_TOKEN='\(.*\)'$/\1/p" /etc/craftmanager/craftmanager.env)"
wait_for "Start of $VERSION" 60 is_version "$VERSION"
systemctl is-active craftmanager craftmanager-update.path

log "Permissions: the application may only request, not decide by itself"
test "$(state | jq -r '.installMode')" = "service"
test "$(sudo stat -c '%U:%G %a' /var/lib/craftmanager-update)" = "root:root 755"
test "$(sudo stat -c '%U:%G %a' /var/lib/craftmanager-update/work)" = "root:root 700"
sudo -u craftmanager touch /var/lib/craftmanager-update/request/probe && sudo -u craftmanager rm /var/lib/craftmanager-update/request/probe
if sudo -u craftmanager sh -c 'echo x > /var/lib/craftmanager-update/status.json' 2>/dev/null; then fail "The application must not write status.json."; fi
if sudo -u craftmanager sh -c 'echo x > /opt/craftmanager/VERSION' 2>/dev/null; then fail "The application must not modify /opt/craftmanager."; fi

log "Forged request (unsigned): the root updater rejects it itself"
FORGED="craftmanager-$NEXT-linux-x64.tar.gz"
sudo -u craftmanager sh -c "cd /var/lib/craftmanager-update/request && echo evil > '$FORGED' && echo '$(printf '0%.0s' $(seq 1 64))  $FORGED' > SHA256SUMS.txt && echo 'AAAA' > SHA256SUMS.txt.sig && printf '{\"schema\":1,\"id\":\"forged-0001\",\"version\":\"$NEXT\",\"from\":\"$VERSION\",\"assetName\":\"$FORGED\",\"requestedAt\":1}' > request.json.tmp && mv request.json.tmp request.json"
wait_for "Rejection of the forged request" 60 sh -c "sudo jq -e '.id==\"forged-0001\" and .state==\"failed\"' /var/lib/craftmanager-update/status.json"
sudo jq -r '.message' /var/lib/craftmanager-update/status.json | grep -qi 'signature'
test "$(cat /opt/craftmanager/VERSION)" = "$VERSION"
test -z "$(sudo ls /var/lib/craftmanager-update/request)"

log "Tampered package: the application rejects it, nothing is installed"
cp "$WORK/pkg-b/craftmanager-$NEXT-linux-x64.tar.gz" "$WORK/craftmanager-$EVIL-linux-x64.tar.gz"
mkdir -p "$GH/v$EVIL"
cp "$WORK/craftmanager-$EVIL-linux-x64.tar.gz" "$GH/v$EVIL/"
node scripts/ci/release-fixture.mjs --dir "$GH/v$EVIL" --key "$KEY" --pub "$PUB"
printf 'tampered' >>"$GH/v$EVIL/craftmanager-$EVIL-linux-x64.tar.gz"
call -X POST "$BASE/api/system/update/check" | jq -e ".updateAvailable == true and .latest.version == \"$EVIL\"" >/dev/null
call -X POST "$BASE/api/system/update/apply" -d '{"confirm":true,"countdownSeconds":0}' >/dev/null
wait_for "Rejection of the tampered package" 60 phase_is failed
state | jq -r '.error' | grep -qiE 'checksum|Pr.fsumme'
test "$(cat /opt/craftmanager/VERSION)" = "$VERSION"
call -X POST "$BASE/api/system/update/dismiss" >/dev/null
rm -rf "$GH/v$EVIL"

log "Update to $NEXT"
release "$NEXT" "$WORK/pkg-b/craftmanager-$NEXT-linux-x64.tar.gz"
call -X POST "$BASE/api/system/update/check" | jq -e ".updateAvailable == true and .latest.version == \"$NEXT\" and .canApply == true" >/dev/null
call -X POST "$BASE/api/system/update/apply" -d '{"confirm":true,"countdownSeconds":0}' | jq -e '.phase == "downloading"' >/dev/null
wait_for "new version $NEXT" 300 is_version "$NEXT"
wait_for "entry in the update history" 90 history_is success
test "$(cat /opt/craftmanager/VERSION)" = "$NEXT"
systemctl is-active craftmanager craftmanager-update.path
state | jq -e ".currentVersion == \"$NEXT\" and .updateAvailable == false" >/dev/null
call -X POST "$BASE/api/system/update/dismiss" >/dev/null

log "Rollback on the broken version $BROKEN"
release "$BROKEN" "$WORK/craftmanager-$BROKEN-linux-x64.tar.gz"
call -X POST "$BASE/api/system/update/check" | jq -e ".latest.version == \"$BROKEN\" and .canApply == true" >/dev/null
call -X POST "$BASE/api/system/update/apply" -d '{"confirm":true,"countdownSeconds":0}' >/dev/null
wait_for "Rollback" 420 history_is rolled_back
wait_for "old version $NEXT is running again" 90 is_version "$NEXT"
test "$(cat /opt/craftmanager/VERSION)" = "$NEXT"
systemctl is-active craftmanager craftmanager-update.path
state | jq -r '.history[0].message' | grep -q "$NEXT"

log "Uninstall keeps the data"
sudo /opt/craftmanager/uninstall.sh
test -d /var/lib/craftmanager
test ! -e /opt/craftmanager
test ! -e /var/lib/craftmanager-update
test ! -e /etc/systemd/system/craftmanager-update.path
printf '\nUpdate test on Linux passed.\n'

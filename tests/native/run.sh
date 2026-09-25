#!/usr/bin/env bash
# The native smoke (S3-01a): a development build on a running emulator (or,
# once iOS builds locally, a booted simulator), pointed at this checkout's
# stack and Metro. Not in `pnpm check`: it needs a device.
#
#   make test-native                 Android (the default)
#   PLATFORM=ios make test-native    iOS simulator (see apps/app/README.md)
#
# What it proves, in order:
#   1. Maya signs in on a fresh install and lands on the app landing: the
#      sign-in was the app's first open (`mark-app-installed`).
#   2. A plan link opened *by the operating system* lands in the app on that
#      plan, signed in as her.
#   3. On a fresh install again, `/join#<secret>` previews the circle — the
#      digest was computed on the device and matched — and joins it.
#
# Needs: the stack (`make up`), Metro for native (`make native-metro`), the
# development build installed (`make native-android`), and Maestro.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
platform=${PLATFORM:-android}
app=app.circles.development

ports=$(make -s -C "$root" ports)
api=$(sed -E 's/.*api ([0-9]+).*/\1/' <<<"$ports")
db=$(sed -E 's/.*db ([0-9]+).*/\1/' <<<"$ports")
mail=$(sed -E 's/.*mail ([0-9]+).*/\1/' <<<"$ports")
metro=$(sed -E 's/.*app ([0-9]+).*/\1/' <<<"$ports")
dburl="postgresql://postgres:postgres@127.0.0.1:$db/postgres"
domain=$(node --input-type=module -e "import { brand } from '$root/packages/config/dist/index.js'; console.log(brand.domain)")

command -v maestro >/dev/null || { echo "test-native: Maestro is not installed (brew install mobile-dev-inc/tap/maestro)" >&2; exit 2; }
curl -fsS "http://localhost:$metro/status" >/dev/null || { echo "test-native: no Metro on $metro — run \`make native-metro\`" >&2; exit 2; }

open_link() { # <url>: as the operating system would, not as the app
  if [ "$platform" = ios ]; then
    xcrun simctl openurl booted "$1"
  else
    # `-p`: until S3-01b publishes real assetlinks values, Android does not
    # verify the claim and would offer the browser; naming the package is
    # what a verified App Link does without being asked.
    adb shell am start -W -a android.intent.action.VIEW -d "'$1'" -p "$app" >/dev/null
  fi
}

fresh_install() { # nothing in storage: no session, no drafts
  if [ "$platform" = ios ]; then
    # Untested here: the local iOS build does not compile under Xcode 26.2
    # (apps/app/README.md). A simulator has no "clear data", so the build is
    # reinstalled from IOS_APP, the .app an EAS simulator build or a local one
    # produced.
    : "${IOS_APP:?set IOS_APP to the simulator build (.app) to reinstall between steps}"
    xcrun simctl uninstall booted "$app" 2>/dev/null || true
    xcrun simctl install booted "$IOS_APP"
    return
  fi
  adb shell pm clear "$app" >/dev/null
  # A debug build asks 10.0.2.2:8081 for its bundle; this checkout's Metro is
  # on $metro, reached through `adb reverse` like the stack is.
  adb reverse "tcp:$metro" "tcp:$metro" >/dev/null
  adb reverse "tcp:$api" "tcp:$api" >/dev/null
  adb shell "run-as $app sh -c 'mkdir -p shared_prefs && echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"debug_http_host\\\">localhost:$metro</string></map>\" > shared_prefs/${app}_preferences.xml'"
}

code_for() { # <address>: the newest sign-in code Mailpit caught for it
  for _ in $(seq 1 40); do
    code=$(MAILPIT_URL="http://127.0.0.1:$mail" node "$root/scripts/local-mail.mjs" "$1" 2>/dev/null | grep -oE '\b[0-9]{6}\b' | head -1 || true)
    [ -n "$code" ] && { echo "$code"; return; }
    sleep 0.5
  done
  echo "test-native: no code for $1" >&2; exit 1
}

maya=00000000-0000-4000-8000-000000000101
circle=00000000-0000-4000-8000-000000000a01

echo "== 1. Maya signs in on a fresh install: the app's first open"
# The seed's Maya has never opened the app; a re-run needs her not to have.
psql "$dburl" -qc "update public.profiles set app_installed_at = null where user_id = '$maya'" >/dev/null
psql "$dburl" -qc "delete from jobs.rate_counters" >/dev/null
fresh_install
curl -fsS -X DELETE "http://127.0.0.1:$mail/api/v1/messages" >/dev/null || true
maestro test -e EMAIL=maya@example.com "$here/sign-in-request.yaml"
maestro test -e CODE="$(code_for maya@example.com)" -e NAME=Maya "$here/sign-in-code.yaml"
test "$(psql "$dburl" -tAc "select app_installed_at is not null from public.profiles where user_id = '$maya'")" = t

echo "== 2. A plan link opened by the operating system lands on the plan, signed in"
open_link "https://$domain/p/pnsundaycr"
maestro test "$here/plan-link.yaml"

echo "== 3. /join#<secret> on a fresh install previews the circle and joins it"
secret="native-smoke-$(date +%s)-$RANDOM-invite"
psql "$dburl" -qc "update public.circle_invites set revoked_at = now() where circle_id = '$circle' and revoked_at is null" >/dev/null
psql "$dburl" -qc "insert into public.circle_invites (circle_id, secret_hash, created_by) values ('$circle', extensions.digest('$secret', 'sha256'), '$maya')" >/dev/null
fresh_install
open_link "https://$domain/join#$secret"
name="Ren$RANDOM"
maestro test -e NAME="$name" "$here/join-link.yaml"
test "$(psql "$dburl" -tAc "select count(*) from public.circle_members where circle_id = '$circle' and display_name_snapshot = '$name' and status = 'active'")" = 1

echo "test-native: ok ($platform)"

#!/usr/bin/env bash
# Tests for gate-lock.sh, in a throwaway directory: no git, no Docker, no gate.
#   .claude/skills/work-tickets-in-parallel/gate-lock.test.sh
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=gate-lock.sh
. "$here/gate-lock.sh"

# The workers run as processes of their own, so each has its own $$ to hold a
# lock with (macOS's bash 3.2 has no BASHPID).
if [ "${1:-}" = --worker ]; then
  gate_dir=$2 gate_limit=$3 kind=$4 name=$5 gate_self="$$ /wt/$5"
  gate_pause() { sleep 0.$((RANDOM % 3 + 1)); }
  inside() { touch "$gate_dir/inside/$$"; ls "$gate_dir/inside" | wc -l | tr -d " " >> "$gate_dir/peaks"
    sleep 0.$((RANDOM % 5 + 3)); rm "$gate_dir/inside/$$"; }
  case $kind in
    attempt) if gate_try >/dev/null; then echo got; sleep 600; else echo wait; fi ;;
    new) gate_acquire >/dev/null; inside; gate_release ;;
    old) # the script before SUS-134: one lock, no counting
      sleep 0.$((RANDOM % 9 + 1)) # arrive while new-script gates are inside
      until mkdir "$gate_dir/ticket-gate.lock" 2>/dev/null; do sleep 0.2; done
      echo "$$ /wt/$name" > "$gate_dir/ticket-gate.lock/holder"; inside
      rm -rf "$gate_dir/ticket-gate.lock" ;;
  esac
  exit 0
fi

gate_dir=$(mktemp -d -t gate-lock-test)
cleanup() {
  local p; for p in $(cat "$gate_dir/pids" 2>/dev/null); do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  rm -rf "$gate_dir"
}
trap cleanup EXIT
fails=0
ok() { echo "ok   $1"; }
no() { echo "FAIL $1" >&2; fails=$((fails + 1)); }
expect() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1 (wanted '$3', got '$2')"; fi; }
live() { sleep 600 >/dev/null 2>&1 & echo $! >> "$gate_dir/pids"; echo $!; } # a pid that stays alive
dead() { sh -c 'echo $$'; }                                                  # a pid that has exited
hold() { mkdir "$gate_dir/$1" && echo "$2" > "$gate_dir/$1/holder"; }
reset() { rm -rf "${gate_dir:?}"/ticket-gate.*; gate_mine="" gate_mine_legacy=0; }
worker() { bash "$here/gate-lock.test.sh" --worker "$gate_dir" "$gate_limit" "$@"; }
# One attempt from a separate process; prints "got" or "wait", and on "got"
# keeps the place until the test ends.
attempt() {
  worker attempt "$1" > "$gate_dir/out.$1" 2>&1 &
  echo $! >> "$gate_dir/pids"
  local i; for i in $(seq 50); do [ -s "$gate_dir/out.$1" ] && break; sleep 0.1; done
  cat "$gate_dir/out.$1"
}

gate_limit=2

reset
expect "first gate gets a place" "$(attempt a)" got
expect "second gate gets a place" "$(attempt b)" got
expect "a third waits at a limit of 2" "$(attempt c)" wait
expect "the first gate also holds the old lock" "$(gate_holder "$gate_dir/ticket-gate.lock" | cut -d' ' -f2)" /wt/a
expect "the old lock held by one of ours is not counted twice" "$(gate_taken)" 2

reset
hold ticket-gate.lock "$(live) /wt/old-script"
expect "an old-script gate's lock counts: one more fits" "$(attempt d)" got
expect "and then nothing does" "$(attempt e)" wait
expect "the old-script lock is left alone" "$(gate_holder "$gate_dir/ticket-gate.lock" | cut -d' ' -f2)" /wt/old-script

reset
hold ticket-gate.1 "$(dead) /wt/gone"
hold ticket-gate.lock "$(dead) /wt/gone-old"
expect "locks left by dead processes are cleared" "$(gate_clear_dead | wc -l | tr -d ' ')" 2
expect "nothing is held after clearing" "$(gate_taken)" 0

reset
hold ticket-gate.1 "$(live) /wt/alive"
hold ticket-gate.2 "garbage"
gate_clear_dead >/dev/null
expect "a live holder and a fresh lock with no pid yet are kept" "$(gate_taken)" 2
touch -t 202601010000 "$gate_dir/ticket-gate.2"
mkdir "$gate_dir/ticket-gate.3"; touch -t 202601010000 "$gate_dir/ticket-gate.3"
expect "a lock with no pid for over a minute is cleared, holder file or not" "$(gate_clear_dead | wc -l | tr -d ' ')" 2
expect "and the live one is still there" "$(gate_holders | cut -d' ' -f1)" ticket-gate.1

reset
gate_self="$$ /wt/me"
gate_try >/dev/null
expect "gate_try takes a numbered place and the free old lock" "$(gate_holders | wc -l | tr -d ' ')" 2
mkdir -p "$gate_dir/ticket-gate.lock"; echo "$(live) /wt/someone-else" > "$gate_dir/ticket-gate.lock/holder"
gate_release
expect "release leaves a lock that is no longer ours" "$(gate_holders | cut -d' ' -f1)" ticket-gate.lock

# The old lock is held at the first try by another new gate that lets go
# before this one takes a place: the second try takes it.
gate_limit=1
reset
gate_self="$$ /wt/me"
hold ticket-gate.lock "$(live) /wt/another-new-gate"
seq() { rm -rf "$gate_dir/ticket-gate.lock"; command seq "$@"; } # it lets go here
gate_try >/dev/null; unset -f seq
expect "a place won while the old lock was briefly held takes the old lock too" "$(gate_holder "$gate_dir/ticket-gate.lock" | cut -d' ' -f2)" /wt/me
gate_release

gate_limit=1
reset
hold ticket-gate.lock "$(live) /wt/old-script"
expect "at a limit of 1, a held old lock fills it" "$(attempt f)" wait

# Many gates at once, new and old script mixed: count who is inside at the
# same moment and never let it pass the limit.
for gate_limit in 1 2 3; do
  reset
  mkdir -p "$gate_dir/inside"
  for n in 1 2 3 4 5 6; do worker new "new$n" & done
  for n in 1 2; do worker old "old$n" & done
  wait
  peak=$(sort -n "$gate_dir/peaks" | tail -1); rm "$gate_dir/peaks"
  if [ "$peak" -le "$gate_limit" ]; then ok "8 racing gates, limit $gate_limit: at most $peak inside"; else no "8 racing gates, limit $gate_limit: $peak inside"; fi
  expect "and every lock is released afterwards (limit $gate_limit)" "$(gate_holders | wc -l | tr -d ' ')" 0
done

[ $fails = 0 ] && echo "gate-lock: all passed" || { echo "gate-lock: $fails failed" >&2; exit 1; }

# Sourced by parallel.sh: how many gates may run at once, and who holds them.
#
# A counting semaphore made of lock directories in the shared .git, one per
# place: ticket-gate.1 .. ticket-gate.<limit>. mkdir is the atomic step, a
# `holder` file inside says "<pid> <worktree>", and a directory whose pid is
# dead is cleared by the next gate that looks. A live holder is never removed.
#
# ticket-gate.lock is the single lock a gate on the script before SUS-134 holds.
# During a switch-over some worktrees still run that script, and it knows
# nothing of the numbered places, so two rules keep the total at the limit:
#
#   - a ticket-gate.lock held by anyone but a numbered holder counts as a place
#     taken; and
#   - a gate on this script also takes ticket-gate.lock whenever it is free, so
#     an old-script gate can only start when one of ours finishes and frees it.
#
# Taking a place is optimistic: mkdir one, then count everyone; over the limit
# means two gates raced, and both let go and try again after a random pause.
#
# Callers set: gate_dir (the shared .git), gate_limit, gate_self ("<pid> <path>").

gate_legacy() { echo "$gate_dir/ticket-gate.lock"; }

gate_holder() { cat "$1/holder" 2>/dev/null || true; }

# Every lock directory that exists: the numbered ones (even past the limit, if
# it was lowered while they were held) and the old single lock.
gate_locks() {
  local d
  for d in "$gate_dir"/ticket-gate.[0-9]*; do [ -d "$d" ] && echo "$d"; done
  [ -d "$(gate_legacy)" ] && gate_legacy
  true
}

gate_clear_dead() {
  local d h pid
  while IFS= read -r d; do
    h=$(gate_holder "$d"); pid=${h%% *}
    # Read again just before removing: a gate that cleared it a moment ago may
    # already hold a new lock of the same name.
    if [[ "$pid" =~ ^[0-9]+$ ]] && ! kill -0 "$pid" 2>/dev/null && [ "$(gate_holder "$d")" = "$h" ]; then
      echo "gate: clearing a lock left by a dead process ($h)"
      rm -rf "$d"
    fi
  done < <(gate_locks)
}

# Places taken: one per numbered lock, plus the old lock unless its holder is
# also a numbered holder (one of ours, holding both). A lock whose holder file
# is not written yet counts, which can only over-count.
gate_taken() {
  local n=0 d pids=" " h
  for d in "$gate_dir"/ticket-gate.[0-9]*; do
    [ -d "$d" ] || continue
    n=$((n + 1)); h=$(gate_holder "$d"); pids="$pids${h%% *} "
  done
  if [ -d "$(gate_legacy)" ]; then
    h=$(gate_holder "$(gate_legacy)"); h=${h%% *}
    if [ -z "$h" ] || [[ "$pids" != *" $h "* ]]; then n=$((n + 1)); fi
  fi
  echo "$n"
}

gate_holders() { # one "<lock> <holder>" line per held lock
  local d; while IFS= read -r d; do echo "$(basename "$d") $(gate_holder "$d")"; done < <(gate_locks)
}

gate_mine="" gate_mine_legacy=0

gate_release() {
  # The old lock first: an old-script gate waiting on it may start the moment
  # it goes, and our numbered place is still held until the line after.
  if [ "$gate_mine_legacy" = 1 ] && [ "$(gate_holder "$(gate_legacy)")" = "$gate_self" ]; then
    rm -rf "$(gate_legacy)"
  fi
  if [ -n "$gate_mine" ] && [ "$(gate_holder "$gate_mine")" = "$gate_self" ]; then
    rm -rf "$gate_mine"
  fi
  gate_mine="" gate_mine_legacy=0
}

# One attempt; 0 when a place is ours (and the old lock too, if it was free).
gate_try() {
  local i
  gate_clear_dead
  if mkdir "$(gate_legacy)" 2>/dev/null; then
    echo "$gate_self" > "$(gate_legacy)/holder"; gate_mine_legacy=1
  fi
  for i in $(seq 1 "$gate_limit"); do
    if mkdir "$gate_dir/ticket-gate.$i" 2>/dev/null; then
      gate_mine=$gate_dir/ticket-gate.$i; echo "$gate_self" > "$gate_mine/holder"; break
    fi
  done
  if [ -n "$gate_mine" ] && [ "$(gate_taken)" -le "$gate_limit" ]; then return 0; fi
  gate_release
  return 1
}

# Wait for a place. Prints who it is waiting for once a minute.
gate_acquire() {
  local said=-60
  until gate_try; do
    if [ $((SECONDS - said)) -ge 60 ]; then
      echo "gate: all $gate_limit places taken, waiting for:"
      gate_holders | sed 's/^/  /'
      said=$SECONDS
    fi
    gate_pause
  done
}

# Random, so two gates that raced do not race again in step.
gate_pause() { sleep $((3 + RANDOM % 5)); }

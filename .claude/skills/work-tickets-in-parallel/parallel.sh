#!/usr/bin/env bash
# Driver for the work-tickets-in-parallel skill: one git worktree and one local
# Supabase stack per ticket, so several tickets can be worked at once without
# sharing a checkout, a database or an Edge runtime. The per-ticket work itself
# is still the implement-linear-ticket skill and its ticket.sh.
#
#   parallel.sh add <git-branch-name> [--base <ref>] [--no-install]
#                                   worktree + slot for a ticket; prints where
#   parallel.sh up                  (in a worktree) start this slot's stack, write the app env
#   parallel.sh down                (in a worktree) stop this slot's stack, keep its data
#   parallel.sh gate                (in a worktree) ticket.sh check, one gate at a time across worktrees
#   parallel.sh sync [<ref>]        (in a worktree) rebase on origin/main (or <ref>) without losing the slot
#   parallel.sh unslot / repatch    (in a worktree) take the slot's patch off config.toml to commit a real change, put it back
#   parallel.sh overlap <path>...   which open PRs touch these paths
#   parallel.sh list                every worktree: slot, branch, ports, ahead/behind, stack
#   parallel.sh rm <sus-n> [--force] stop the stack, throw its data away, remove the worktree, free the slot
#
# Slot 0 is the primary checkout and is never touched. Slots 1..PARALLEL_SLOTS
# (default 3) shift every local port by 100 x slot and rename the Supabase
# project, in that worktree's supabase/config.toml only; the file is marked
# skip-worktree there so the patch cannot be committed.
set -euo pipefail

die() { echo "parallel.sh: $*" >&2; exit 1; }

top=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git checkout"
common=$(cd "$top" && cd "$(git rev-parse --git-common-dir)" && pwd)
primary=$(dirname "$common")
wtroot=${PARALLEL_ROOT:-$(dirname "$primary")/$(basename "$primary")-wt}
slots=$common/ticket-slots
lock=$common/ticket-gate.lock
max=${PARALLEL_SLOTS:-3}
base=${TICKET_BASE:-main}
ticket_sh=.claude/skills/implement-linear-ticket/ticket.sh
# What CI leaves out of the stack (check.yml); the gate passes without them and
# each one is memory a second and third stack cannot spare.
exclude=${PARALLEL_EXCLUDE:-realtime,storage-api,imgproxy,studio,logflare,vector,supavisor}

pnpm_() { if command -v pnpm >/dev/null 2>&1; then pnpm "$@"; else corepack pnpm "$@"; fi; }

slot_of() { # slot number for a worktree path, empty if none
  local f; for f in "$slots"/*; do
    [ -f "$f" ] && [ "$(cat "$f")" = "$1" ] && { basename "$f"; return; }
  done; true
}
here_slot() {
  [ "$top" != "$primary" ] || die "this is the primary checkout (slot 0); run this inside a ticket worktree"
  local s; s=$(slot_of "$top"); [ -n "$s" ] || die "$top has no slot; it was not made by 'parallel.sh add'"
  echo "$s"
}
ports() { # human summary for a slot
  local s=$1
  echo "api $((54321 + s * 100)) · db $((54322 + s * 100)) · mail $((54324 + s * 100)) · app $((8081 + s * 100))"
}

patch_config() { # <dir> <slot>
  local cfg=$1/supabase/config.toml s=$2
  [ -f "$cfg" ] || die "no supabase/config.toml in $1"
  S=$s perl -pi -e '
    s/(?<!\d)543(\d\d)(?!\d)/"54".(3+$ENV{S}).$1/ge;
    s/^project_id = "([^"]+)"/project_id = "$1-s$ENV{S}"/;
    s/^inspector_port = (\d+)/"inspector_port = ".($1+100*$ENV{S})/e;
  ' "$cfg"
  git -C "$1" update-index --skip-worktree supabase/config.toml
}
unpatch_config() { # <dir>
  git -C "$1" update-index --no-skip-worktree supabase/config.toml
  git -C "$1" checkout -- supabase/config.toml
}

cmd_add() {
  local name="" from="" install=1
  while [ $# -gt 0 ]; do case $1 in
    --base) from=${2:-}; shift 2 ;;
    --no-install) install=0; shift ;;
    -*) die "unknown flag $1" ;;
    *) name=$1; shift ;;
  esac; done
  [ -n "$name" ] || die "usage: add <git-branch-name> (Linear's gitBranchName) [--base <ref>] [--no-install]"
  local id; id=$(echo "$name" | grep -oiE 'sus-[0-9]+' | head -1 | tr 'A-Z' 'a-z') || true
  [ -n "$id" ] || die "no sus-N in '$name'; use Linear's gitBranchName verbatim"
  local dir=$wtroot/$id
  [ ! -e "$dir" ] || die "$dir already exists (parallel.sh list)"

  mkdir -p "$slots" "$wtroot"
  local s="" n
  for n in $(seq 1 "$max"); do [ -e "$slots/$n" ] || { s=$n; break; }; done
  [ -n "$s" ] || die "all $max slots are taken (parallel.sh list); finish one, or raise PARALLEL_SLOTS if the machine has the memory"

  git -C "$primary" fetch --quiet origin "$base"
  if [ -z "$from" ]; then
    # Same rule as ticket.sh start: local main when it contains origin/main.
    from="origin/$base"
    git -C "$primary" merge-base --is-ancestor "origin/$base" "$base" 2>/dev/null && from=$base
  fi
  if git -C "$primary" show-ref --verify --quiet "refs/heads/$name"; then
    git -C "$primary" worktree add --quiet "$dir" "$name"
  else
    git -C "$primary" worktree add --quiet -b "$name" "$dir" "$from"
  fi
  echo "$dir" > "$slots/$s"
  patch_config "$dir" "$s"

  # Untracked environment files do not come with a worktree. The app's
  # .env.local is not copied: `up` writes this slot's own.
  local f; for f in .env; do
    [ -f "$primary/$f" ] && cp "$primary/$f" "$dir/$f"
  done

  if [ $install = 1 ]; then
    # dist/ has to exist before the stack starts: the Edge runtime bind-mounts
    # the worktree and never sees a file created after it booted (AGENTS.md).
    # Quiet on success; on failure the tail of the log, and the worktree and
    # slot are kept so the fix can be made in place.
    local log; log=$(mktemp -t parallel-add)
    if ! (cd "$dir" && pnpm_ i --frozen-lockfile --prefer-offline && pnpm_ build) >"$log" 2>&1; then
      tail -30 "$log" >&2
      die "install or build failed in $dir (full log: $log). Slot $s is kept; fix it there and run: cd $dir && pnpm i && pnpm build"
    fi
    rm -f "$log"
  fi

  echo "worktree: $dir"
  echo "branch:   $name (from $from)"
  echo "slot:     $s · $(ports "$s")"
  echo "next:     cd $dir && $0 up"
}

cmd_up() {
  local s; s=$(here_slot); cd "$top"
  [ -d node_modules ] || die "no node_modules here; run: pnpm i && pnpm build"
  # The Makefile reads every port out of this worktree's own config.toml, so
  # `make up` and `make env` do the right thing per slot; this keeps one copy of
  # each command. A branch cut before the Makefile learned about slots falls
  # back to the calls it replaced.
  if make -n up >/dev/null 2>&1 && make ports 2>/dev/null | grep -q "slot $s"; then
    make up && make env
  else
    local sb=node_modules/.bin/supabase
    "$sb" status >/dev/null 2>&1 || "$sb" start -x "$exclude"
    local env=apps/app/.env.local
    "$sb" status -o env 2>/dev/null \
      | sed -n 's/^API_URL=/EXPO_PUBLIC_SUPABASE_URL=/p; s/^ANON_KEY=/EXPO_PUBLIC_SUPABASE_ANON_KEY=/p' > "$env"
    echo "EXPO_PUBLIC_APP_ORIGIN=http://localhost:$((8081 + s * 100))" >> "$env"
  fi
  echo "slot $s is up · $(ports "$s")"
  echo "dev server: make dev      (web app on $((8081 + s * 100)))"
  echo "served build: make dev-live  (on $((8082 + s * 100)), what the live suite serves)"
  echo "mail:       make mail TO=someone@example.com"
}

cmd_down() { here_slot >/dev/null; cd "$top"; node_modules/.bin/supabase stop; }

cmd_gate() {
  here_slot >/dev/null; cd "$top"
  # One gate at a time. The stacks are separate, but the Playwright suites
  # serve on fixed ports (8082, 8083) and a six-minute gate wants the machine.
  local waited=0
  until mkdir "$lock" 2>/dev/null; do
    local holder; holder=$(cat "$lock/holder" 2>/dev/null || echo unknown)
    local pid=${holder%% *}
    if [[ "$pid" =~ ^[0-9]+$ ]] && ! kill -0 "$pid" 2>/dev/null; then
      echo "gate: clearing a lock left by a dead process ($holder)"; rm -rf "$lock"; continue
    fi
    [ $((waited % 60)) = 0 ] && echo "gate: waiting for $holder"
    sleep 5; waited=$((waited + 5))
  done
  echo "$$ $top" > "$lock/holder"
  trap 'rm -rf "$lock"' EXIT
  # The live suite reads codes from Mailpit, which defaults to slot 0's port.
  local s; s=$(slot_of "$top")
  MAILPIT_URL=${MAILPIT_URL:-http://127.0.0.1:$((54324 + s * 100))} "$ticket_sh" check
}

cmd_sync() {
  local s; s=$(here_slot); cd "$top"
  local onto=${1:-origin/$base}
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "uncommitted changes; commit first"
  git fetch --quiet origin
  # The slot's patch would make the rebase refuse to touch config.toml.
  unpatch_config "$top"
  local rc=0
  git rebase "$onto" || rc=$?
  if [ $rc -ne 0 ]; then
    echo "parallel.sh: the rebase stopped. Resolve it, 'git rebase --continue', then run:" >&2
    echo "    $0 repatch" >&2
    exit $rc
  fi
  patch_config "$top" "$s"
  echo "rebased onto $onto; slot $s restored."
  echo "Generated files are regenerated, never merged by hand: pnpm gen:functions && pnpm gen:types, then '$0 gate'."
}

# A ticket that really has to change config.toml (a new [functions.x] block, an
# auth provider) cannot do it through the patch: skip-worktree hides the edit
# from git. unslot -> edit -> commit -> repatch, with this slot's stack down.
cmd_unslot() { here_slot >/dev/null; unpatch_config "$top"; echo "config.toml is the committed one again; edit, commit, then: $0 repatch"; }

cmd_repatch() { local s; s=$(here_slot); patch_config "$top" "$s"; echo "slot $s restored"; }

cmd_overlap() {
  [ $# -gt 0 ] || die "usage: overlap <path-or-prefix>..."
  gh auth status >/dev/null 2>&1 || die "gh is not authenticated (gh auth login)"
  local hit=0 line
  while IFS=$'\t' read -r num head file; do
    for p in "$@"; do
      case $file in "$p"*) echo "PR #$num ($head) touches $file"; hit=1 ;; esac
    done
  done < <(gh pr list --state open --limit 50 --json number,headRefName,files \
    --jq '.[] | . as $pr | .files[] | [$pr.number, $pr.headRefName, .path] | @tsv')
  [ $hit = 1 ] || echo "no open PR touches those paths"
}

cmd_list() {
  printf '%-5s %-10s %-28s %s\n' slot ticket "vs origin/$base" branch
  printf '%-5s %-10s %-28s %s\n' 0 primary - "$(git -C "$primary" rev-parse --abbrev-ref HEAD)"
  local f; for f in "$slots"/*; do
    [ -f "$f" ] || continue
    local d; d=$(cat "$f")
    if [ ! -d "$d" ]; then printf '%-5s %s\n' "$(basename "$f")" "stale: $d is gone ('rm $(basename "$d") --force' frees it)"; continue; fi
    local ab; ab=$(git -C "$d" rev-list --left-right --count "origin/$base...HEAD" 2>/dev/null | awk '{print "behind "$1", ahead "$2}')
    printf '%-5s %-10s %-28s %s\n' "$(basename "$f")" "$(basename "$d")" "$ab" "$(git -C "$d" rev-parse --abbrev-ref HEAD)"
  done
  [ -d "$lock" ] && echo "gate held by: $(cat "$lock/holder" 2>/dev/null)" || true
}

cmd_rm() {
  local id=${1:-} force=${2:-}; [ -n "$id" ] || die "usage: rm <sus-n> [--force]"
  local dir=$wtroot/$id s; s=$(slot_of "$dir")
  if [ -d "$dir" ]; then
    if [ "$force" != --force ]; then
      [ -z "$(git -C "$dir" status --porcelain --untracked-files=no -- . ':!supabase/config.toml')" ] || die "$id has uncommitted changes (--force discards them)"
      local b; b=$(git -C "$dir" rev-parse --abbrev-ref HEAD)
      [ -z "$(git -C "$dir" log --oneline "origin/$b..HEAD" 2>/dev/null || echo unpushed)" ] || die "$id has commits that are not on origin/$b (--force discards nothing in git, but check first)"
    fi
    [ -x "$dir/node_modules/.bin/supabase" ] && (cd "$dir" && node_modules/.bin/supabase stop --no-backup >/dev/null 2>&1) || true
    git -C "$primary" worktree remove --force "$dir"
  fi
  [ -n "$s" ] && rm -f "$slots/$s"
  git -C "$primary" worktree prune
  echo "removed $id${s:+ (slot $s freed)}; the branch is kept"
}

case "${1:-}" in
  add|up|down|gate|sync|unslot|repatch|overlap|list|rm) c=$1; shift; "cmd_$c" "$@" ;;
  *) sed -n '2,21p' "$0"; exit 1 ;;
esac

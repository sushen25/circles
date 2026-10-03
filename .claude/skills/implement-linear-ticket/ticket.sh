#!/usr/bin/env bash
# Driver for the implement-linear-ticket skill. Git + GitHub half of the
# workflow; the Linear half is done through the Linear MCP tools (see SKILL.md).
#
#   ticket.sh start  <git-branch-name>          branch from fresh origin/main
#   ticket.sh check                             run whatever checks this repo has
#   ticket.sh push   [--dry-run]                push current branch, set upstream
#   ticket.sh pr     <SUS-N> "<title>" [--draft] open the GitHub PR, print its URL
#   ticket.sh status                            branch / dirty files / gh auth
#
# TICKET_BASE (default main) is the branch everything is measured against and
# the PR is opened onto; set it to the previous ticket's branch for a stacked PR.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
base=${TICKET_BASE:-main}
# ref to diff against: local main if it already contains origin/main, else origin/main
baseref() { git merge-base --is-ancestor "origin/$base" "$base" 2>/dev/null && echo "$base" || echo "origin/$base"; }

die() { echo "ticket.sh: $*" >&2; exit 1; }
branch() { git rev-parse --abbrev-ref HEAD; }

cmd_start() {
  local name=${1:-}; [ -n "$name" ] || die "usage: start <git-branch-name> (Linear's gitBranchName)"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "working tree has uncommitted changes; commit or stash first"
  git fetch --quiet origin "$base"
  # Branch from local main when it is a fast-forward of origin/main (solo dev,
  # unpushed commits on main); otherwise from origin/main.
  local from="origin/$base"
  if git merge-base --is-ancestor "origin/$base" "$base" 2>/dev/null; then
    from=$base
    local ahead; ahead=$(git rev-list --count "origin/$base..$base")
    [ "$ahead" = 0 ] || echo "note: local $base is $ahead commit(s) ahead of origin/$base (unpushed); branching from local $base"
  fi
  if git show-ref --verify --quiet "refs/heads/$name"; then
    git switch --quiet "$name"
    echo "switched to existing branch $name ($(git rev-list --count "$from..HEAD") commits ahead of $from)"
  else
    git switch --quiet -c "$name" "$from"
    echo "created $name from $from ($(git rev-parse --short "$from"))"
  fi
}

# --- The stack's Edge runtime -------------------------------------------------
# Its memory grows by about 2 GB per gate and is never given back (SUS-134 saw
# one OOM-killed, exit 137, while its gate ran alone). From inside a gate that
# looks like a 503 or BOOT_ERROR from every function, i.e. like a code failure.
# So a check starts this checkout's Edge runtime fresh, and says so when one
# was OOM-killed anyway. Only this checkout's own container, named by the
# project_id in its supabase/config.toml (circles, circles-s1, ...).
edge_container() {
  local id; id=$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml 2>/dev/null | head -1)
  [ -n "$id" ] && echo "supabase_edge_runtime_$id"
}

# `docker restart` of the one container, about a second, and only once the
# gateway answers again. Does nothing when docker, the container or the stack
# is missing, or TICKET_EDGE_RESTART=0.
edge_fresh() {
  [ "${TICKET_EDGE_RESTART:-1}" = 0 ] && return 0
  command -v docker >/dev/null 2>&1 || return 0
  local c; c=$(edge_container) || return 0
  docker inspect "$c" >/dev/null 2>&1 || { echo "== edge runtime: $c is not running; nothing to restart"; return 0; }
  local mem; mem=$(docker stats --no-stream --format '{{.MemUsage}}' "$c" 2>/dev/null | cut -d/ -f1 | tr -d ' ')
  local t0=$SECONDS
  docker restart "$c" >/dev/null 2>&1 || { echo "== edge runtime: could not restart $c (continuing)"; return 0; }
  # Any reply but 502/503 or no connection means the runtime is serving.
  local port; port=$(awk '/^\[api\]/{a=1;next} /^\[/{a=0} a&&/^port *=/{print $3; exit}' supabase/config.toml)
  local code=000 i
  for i in $(seq 1 60); do
    code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${port:-54321}/functions/v1/hello" 2>/dev/null || true)
    case $code in 000|502|503) sleep 0.5 ;; *) break ;; esac
  done
  echo "== edge runtime: restarted $c (was${mem:+ $mem}, answering again after $((SECONDS - t0))s)"
}

# After a failed check: if the container was OOM-killed, say it is the machine
# and not the code. A restart at the start of the check clears the flag, so a
# true flag now means it happened during this check.
edge_report() {
  command -v docker >/dev/null 2>&1 || return 0
  local c; c=$(edge_container) || return 0
  [ "$(docker inspect -f '{{.State.OOMKilled}}' "$c" 2>/dev/null || true)" = true ] || return 0
  cat >&2 <<EOM
== edge runtime OOM-killed, not your code: $c ran out of Docker's memory during this check.
   Every Edge Function answered 503 or BOOT_ERROR after that point. Free memory (other
   slots' edge runtimes grow too: docker stats --no-stream), then: make restart, and rerun.
EOM
}

cmd_check() {
  local rc=0
  echo "== changed vs $(baseref)"
  git fetch --quiet origin "$base"
  git diff --stat "$(baseref)...HEAD" | tail -20
  echo "== git diff --check (whitespace errors)"
  git diff --check "$(baseref)...HEAD" || rc=1
  if [ -f package.json ] && node -e 'process.exit(require("./package.json").scripts?.check ? 0 : 1)'; then
    edge_fresh
    echo "== pnpm check"
    corepack pnpm check || { rc=1; edge_report; }
  else
    echo "== no check script in package.json; skipping pnpm check"
  fi
  if git diff --name-only "$(baseref)...HEAD" | grep -q '^docs/design/'; then
    # The canvas is generated. Regenerate it and fail if the committed
    # artboards do not match gen.py — the same drift question the
    # run-design-canvas skill used to ask, without depending on that skill.
    echo "== docs/design changed: regenerating the canvas to check for drift"
    if python3 docs/design/gen.py >/dev/null; then
      if ! git diff --quiet -- docs/design/; then
        echo "differs: docs/design is stale — regenerate and commit:" >&2
        git diff --name-only -- docs/design/ | sed 's/^/  /' >&2
        rc=1
      fi
    else
      echo "docs/design/gen.py failed to run" >&2
      rc=1
    fi
  fi
  [ $rc -eq 0 ] && echo "check: ok" || echo "check: FAILED" >&2
  return $rc
}

cmd_push() {
  local b; b=$(branch)
  [ "$b" != "$base" ] || die "refusing to push $base; run start first"
  git push "$@" -u origin "$b"
}

cmd_pr() {
  local id=${1:-} title=${2:-}; shift 2 || die 'usage: pr <SUS-N> "<title>" [--draft]'
  [[ "$id" =~ ^[A-Z]+-[0-9]+$ ]] || die "first arg must be a Linear identifier like SUS-6"
  local b; b=$(branch)
  [ "$b" != "$base" ] || die "on $base; run start first"
  if ! gh auth status >/dev/null 2>&1; then
    echo "gh is not authenticated. One-time setup (interactive, needs a browser):" >&2
    echo "    gh auth login --hostname github.com --git-protocol ssh --web" >&2
    exit 2
  fi
  git rev-parse --verify --quiet "origin/$b" >/dev/null || cmd_push
  local url="https://linear.app/sushen-project/issue/$id"
  local body
  body=$(cat <<BODY
## Linear

$id: $url

## Summary

$(git log --reverse --format='- %s' "$(baseref)..HEAD" | grep -v 'Co-Authored-By')

## Checks

- \`ticket.sh check\` run locally; CI runs the same \`check\` workflow plus gitleaks over the branch history

## Decisions taken

<!-- anything the ticket asked you to decide; mirror it in a Linear comment -->

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)
  local existing
  existing=$(gh pr view "$b" --json url --jq .url 2>/dev/null || true)
  if [ -n "$existing" ]; then echo "PR already exists: $existing"; echo "$existing"; return 0; fi
  gh pr create --base "$base" --head "$b" --title "$id $title" --body "$body" "$@"
}

cmd_status() {
  echo "branch:   $(branch)"
  git fetch --quiet origin "$base" 2>/dev/null || true
  echo "vs $(baseref):  $(git rev-list --left-right --count "$(baseref)...HEAD" | awk '{print "behind "$1", ahead "$2}')"
  echo "upstream: $(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo '(none, not pushed)')"
  echo "dirty:    $(git status --porcelain | wc -l | tr -d ' ') files"
  if gh auth status >/dev/null 2>&1; then echo "gh:       authenticated as $(gh api user --jq .login)"; else echo "gh:       NOT authenticated (gh auth login)"; fi
}

case "${1:-}" in
  start|check|push|pr|status) c=$1; shift; "cmd_$c" "$@" ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac

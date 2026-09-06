#!/usr/bin/env bash
# Driver for the implement-linear-ticket skill. Git + GitHub half of the
# workflow; the Linear half is done through the Linear MCP tools (see SKILL.md).
#
#   ticket.sh start  <git-branch-name>          branch from fresh origin/main
#   ticket.sh check                             run whatever checks this repo has
#   ticket.sh push   [--dry-run]                push current branch, set upstream
#   ticket.sh pr     <SUS-N> "<title>" [--draft] open the GitHub PR, print its URL
#   ticket.sh status                            branch / dirty files / gh auth
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

cmd_check() {
  local rc=0
  echo "== changed vs $(baseref)"
  git fetch --quiet origin "$base"
  git diff --stat "$(baseref)...HEAD" | tail -20
  echo "== git diff --check (whitespace errors)"
  git diff --check "$(baseref)...HEAD" || rc=1
  if [ -f package.json ] && node -e 'process.exit(require("./package.json").scripts?.check ? 0 : 1)'; then
    echo "== pnpm check"
    corepack pnpm check || rc=1
  else
    echo "== no package.json check script yet (S0-01 adds it); skipping pnpm check"
  fi
  if git diff --name-only "$(baseref)...HEAD" | grep -q '^docs/design/'; then
    echo "== docs/design changed: design canvas check"
    python3 .claude/skills/run-design-canvas/driver.py check || rc=1
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

- \`ticket.sh check\` run locally (see PR checks for CI once S0-09 lands)

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

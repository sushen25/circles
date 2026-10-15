#!/usr/bin/env bash
# Tests for `parallel.sh overlap` (SUS-148), against a throwaway repository and a
# stand-in `gh`: no network, no Docker, nothing of any real worktree is touched.
#   .claude/skills/work-tickets-in-parallel/overlap.test.sh
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tmp=$(mktemp -d -t overlap-test)
trap 'rm -rf "$tmp"' EXIT
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git init -q --bare "$tmp/origin.git"
git init -q -b main "$tmp/work"
cd "$tmp/work"
git remote add origin "$tmp/origin.git"
echo base > readme; git add .; git commit -qm base; git push -q origin main

# big: 150 files under big/, so file 150 is past the 100 that `gh --json files` returns.
git checkout -q -b big main
mkdir big; for i in $(seq -w 1 150); do echo "$i" > "big/f$i.txt"; done
git add .; git commit -qm big; git push -q origin big
# stacked: on top of big, adds one file; against its real base it shows only that.
git checkout -q -b stacked big
echo s > stacked-only.txt; echo c > "big/café.txt"; git add .; git commit -qm stacked; git push -q origin stacked
git push -q origin big:refs/pull/1/head stacked:refs/pull/2/head
# decoy: a branch on origin that shares a name with a fork PR's head but is unrelated.
git checkout -q -b forky main; echo x > decoy.txt; git add .; git commit -qm decoy; git push -q origin forky
git push -q origin big:refs/pull/4/head
# PR 3 is listed by gh but has no head ref on origin.
git checkout -q main

mkdir "$tmp/bin"
cat > "$tmp/bin/gh" <<'GH'
#!/usr/bin/env bash
# `gh auth status` succeeds; `gh pr list` prints what --jq would have: number, head, base.
case "$1 $2" in
  "auth status") exit 0 ;;
  "pr list") printf '%b' "$FAKE_PRS" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
GH
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH"

run() { bash "$here/parallel.sh" overlap "$@"; }

FAKE_PRS='1\tbig\tmain\n2\tstacked\tbig\n'; export FAKE_PRS
out=$(run big/f150.txt 2>&1) && st=0 || st=$?
{ [ $st = 0 ] && [ "$out" = "PR #1 (big) touches big/f150.txt" ]; } && ok "a PR with 150 files reports the 150th" || bad "150th file: status $st, got: $out"

out=$(run stacked-only.txt big/f001.txt 2>&1) && st=0 || st=$?
{ [ $st = 0 ] && [ "$out" = "PR #1 (big) touches big/f001.txt
PR #2 (stacked) touches stacked-only.txt" ]; } && ok "a stacked PR shows only what it adds over its base" || bad "stacked: status $st, got: $out"

out=$(run "big/café.txt" 2>&1) && st=0 || st=$?
{ [ $st = 0 ] && [ "$out" = "PR #2 (stacked) touches big/café.txt" ]; } && ok "a non-ASCII file name still matches" || bad "non-ASCII: status $st, got: $out"

FAKE_PRS='4\tforky\tmain\n'; export FAKE_PRS
out=$(run big/f150.txt decoy.txt 2>&1) && st=0 || st=$?
{ [ $st = 0 ] && [ "$out" = "PR #4 (forky) touches big/f150.txt" ]; } && ok "the PR's own head is read, not an origin branch of the same name" || bad "fork: status $st, got: $out"

FAKE_PRS='1\tbig\tmain\n2\tstacked\tbig\n'; export FAKE_PRS
out=$(run nothing/ 2>&1) && st=0 || st=$?
{ [ $st = 0 ] && [ "$out" = "no open PR touches those paths" ]; } && ok "no overlap says so" || bad "none: status $st, got: $out"

FAKE_PRS='1\tbig\tmain\n3\tgone\tmain\n'; export FAKE_PRS
out=$(run big/f150.txt 2>&1) && st=0 || st=$?
{ [ $st = 2 ] && grep -q "touches big/f150.txt" <<<"$out" && grep -q "INCOMPLETE.*#3" <<<"$out"; } \
  && ok "a PR whose files cannot be read is named and the status is 2" || bad "unreadable: status $st, got: $out"

out=$(run nothing/ 2>&1) && st=0 || st=$?
{ [ $st = 2 ] && grep -q "INCOMPLETE" <<<"$out" && ! grep -qx "no open PR touches those paths" <<<"$out"; } \
  && ok "no hit among unreadable PRs is not reported as a clean miss" || bad "partial miss: status $st, got: $out"

exit $fail

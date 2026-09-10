---
name: implement-linear-ticket
description: Work a Linear ticket end to end - fetch SUS-N from Linear, check its blockers, branch from main with Linear's branch name, implement it, run the repo checks, push, open a GitHub PR with gh, move the ticket to In Review, write findings onto the tickets that will act on them, and work the review rounds until one comes back clean. Use when asked to implement, work, pick up, start, or ship a Linear ticket / issue (SUS-6, S1-02, "the monorepo ticket"), to open the PR for one, or to address review findings on one.
---

Encodes the "Working a ticket" steps in `docs/tickets.md` for the Circles repo.
Two handles: the **Linear MCP tools** (`get_issue`, `save_issue`, `save_comment`
on the Linear server) for the ticket side, and
`.claude/skills/implement-linear-ticket/ticket.sh` for the git/GitHub side.
Paths are relative to the repo root. `docs/tickets.md` maps S-numbers
(`S0-01`) to Linear ids (`SUS-6`); the MCP wants the Linear id.

## Prerequisites

- `git` with SSH access to `github.com:sushen25/circles.git` (`ssh -T git@github.com` greets `sushen25`).
- GitHub CLI, installed with Homebrew in this session:

```bash
brew install gh
```

- `gh` authenticated. **Not done in this session** (needs a browser; the
  git-credential/keychain route is off limits to the agent). The driver's `pr`
  step exits 2 and prints the command to run once, which is
  `gh auth login --hostname github.com --git-protocol ssh --web`. Ask the user
  to run it if `ticket.sh status` says `NOT authenticated`.
- The Linear MCP server connected (tool names start with `mcp__…__get_issue`).
  Team is `Sushen`, project `Circles MVP`, states: Backlog, Todo, In Progress,
  In Review, Done, Canceled, Duplicate.

## Run (agent path)

`ticket.sh` commands, all run in this session:

| command | what it does |
|---|---|
| `ticket.sh status` | branch, ahead/behind main, upstream, dirty file count, gh auth |
| `ticket.sh start <gitBranchName>` | fetch, branch from `main` (local main if it contains origin/main, else origin/main); refuses on tracked uncommitted changes; switches if the branch exists |
| `ticket.sh check` | diff stat vs main, `git diff --check`, `pnpm check` if `package.json` has a `check` script, design-canvas `check` if `docs/design/` changed; exit 1 on any failure |
| `ticket.sh push [--dry-run]` | `git push -u origin <branch>`; refuses on `main` |
| `ticket.sh pr SUS-N "title" [--draft]` | pushes if needed, `gh pr create --base main` titled `SUS-N title` with a body linking the ticket and listing commits; prints the PR URL; exit 2 if gh is not authenticated; prints the existing PR if one is open |

Steps, in order:

1. **Fetch the ticket.** Call `get_issue` with `id: "SUS-N"`, `includeRelations: true`.
   Use `title`, `description` (sections: Context, Read first, Scope,
   Implementation, Acceptance criteria, Tests, Out of scope), `gitBranchName`,
   `status`, `url`, `relations.blockedBy`. If the user gave an S-number, map it
   through `docs/tickets.md` first.
2. **Check blockers.** For every id in `relations.blockedBy`, `get_issue` it;
   all must be `Done` (or `Canceled`). Otherwise stop and report which block.
3. **Read first.** `AGENTS.md` if it exists (S0-10 creates it; absent today),
   then everything in the ticket's "Read first" list, then `docs/tickets.md`
   "Working a ticket".
4. **Claim it.** `save_issue` with `id: "SUS-N"`, `state: "In Progress"`
   (add `assignee: "me"` if unassigned).
5. **Branch.**

```bash
.claude/skills/implement-linear-ticket/ticket.sh start sushensatturu25/sus-69-add-implement-linear-ticket-skill-fetch-a-linear-ticket
```

   Expected: `created <branch> from main (<sha>)`, possibly preceded by a
   `note: local main is N commit(s) ahead of origin/main` line.
6. **Implement** within the ticket's Scope; respect Out of scope. Commit with
   the repo's trailer (`Co-Authored-By: Claude …`). Anything the ticket asked you
   to decide goes in a Linear comment (step 9) and the PR body's "Decisions taken".
7. **Check.**

```bash
.claude/skills/implement-linear-ticket/ticket.sh check
```

   Must end with `check: ok`. Fix and re-run otherwise. Also walk the ticket's
   Acceptance criteria and the definition of done (`docs/mvp-product-spec.md` §16).
8. **Push and open the PR.**

```bash
.claude/skills/implement-linear-ticket/ticket.sh push --dry-run
.claude/skills/implement-linear-ticket/ticket.sh pr SUS-69 "Add implement-linear-ticket skill"
```

   Drop `--dry-run` for the real push (`pr` also pushes if the branch has no
   upstream). `pr` prints the URL on success. On exit 2, the user has to
   authenticate `gh` first (see Prerequisites); the branch is still pushed.
9. **Hand over in Linear.** `save_issue` with `id`, `state: "In Review"`,
   `links: [{url: <PR URL>, title: "PR #<n>"}]`. `save_comment` with
   `issueId: "SUS-N"` and a short body: PR link, decisions taken, anything left
   out and why. (Linear also auto-links the PR because the branch name is its
   `gitBranchName` and the title starts with the id.)
10. **Write the findings onto the tickets that will act on them**, not only this
    one. A comment here is read by nobody: whoever picks up the next ticket
    opens *theirs*. Anything a later ticket must do differently — a column that
    has to be nullable, a template that sends the wrong thing, a state the
    designs need — goes on that ticket, naming what to do and why. Blocking
    relations say something is pending, not what was learned.
11. **Report** to the user: PR URL, checks run, decisions, open questions.
12. **Review**, below. The ticket is not done when the PR opens.

## Review

An adversarial review runs against the branch and the agent works the findings.
The ticket moves to Done only after the rounds are finished **and** the founder
merges.

**The founder triggers the review**, currently with `/codex:review --base main`
from the ticket's branch — a plugin installed on their machine, not part of this
repo, so do not assume it is available and do not try to invoke it. `/code-review`
is the built-in alternative. What follows is about responding to findings, and
holds whoever produced them.

**Every P0 and P1 is fixed, always.** There is no round budget for those and no
judgement call about them: if the reviewer marks a finding P0 or P1, either the
code changes or the finding is shown to be wrong, with the reproduction that
shows it. S1-05's P1 was a token interpolated into an exception message, which
means a token in a log — the kind of thing that is cheap now and unfixable
later.

**Three rounds, then stop.** Ask for another round after each fix, because
findings surface in layers: S1-02 took two rounds and S1-03 five, and two of
S1-03's findings were only reachable once an earlier fix had changed the shape
of the code. But the returns fall off, and a fourth round on a P2 that is really
a preference costs more attention than it buys.

So: run at most **three** rounds of P2-and-below. If round three still comes back
with P2s, write them up in the PR comment — what was found, why it was not done
now, whether it belongs on a later ticket — and hand over. The exception is
severity: **a P0 or P1 in any round restarts the obligation**, and rounds keep
going until no P0 or P1 comes back. Ending on unaddressed P2s is a decision to
state out loud, not a thing to do quietly.

**Push every round before the founder merges.** A fix that is committed locally
and not pushed is a fix that is not in the PR: S1-05 was merged at its first
commit while four rounds of review fixes — the P1 included — sat on the branch
behind it, and they needed a second PR to land. `git push` after each round, and
check `gh pr view <n> --json headRefOid` against `git rev-parse HEAD` before
saying a PR is ready.

**Verify before you fix.** Reproduce the finding against the built package —
`pnpm run build` then a `node -e` import of `packages/domain/dist/…` — and keep
the output. Then fix, and run the same reproduction again. On S1-03 a finding was twice
real while the reported cause was not the whole cause, and once the obvious fix
would have broken a different invariant.

**Say so when a citation is weak, and separately whether the finding stands.**
One review cited an AGENTS.md line about storing instants as requiring
zone-local rounding. The line does not say that; the finding was right anyway
for a better reason found in the code. Both halves are worth saying.

**Write the test that would have caught it.** More than once the existing test
passed on the broken code because it asserted the wrong property — cell
*duration* when the bug was in the cell's *label*, or an epoch alignment when
the painter produced local alignment. If a test would have passed before the
fix, it is not the test.

**`vitest run` does not typecheck tests.** `pnpm --filter … exec vitest run`
passing means less than it looks; a changed return type broke four call sites
that only `pnpm check` found. Report the gate, not the filtered run.

**A finding about a product rule is an ADR, not a code change.** Non-negotiable
1: product rules live in the spec and change only through an ADR. If the review
says "the spec says X and the code does Y", either conform or write the ADR and
update the spec — a decision recorded in a Linear ticket is not the spec, and a
client built against the spec will disagree with the code.

**Fixing an exported shape invalidates the notes you left.** When a fix changes
a signature, an error shape or a documented behaviour, go back to the downstream
tickets from step 10 and correct them. Three notes on SUS-31, SUS-42 and SUS-49
told later tickets to use a `TransitionError.message` that review then removed.

**Then reply on the PR** with what was found, what changed, what you pushed back
on, any P2 left open at round three and why, and the reproduction output.
`gh pr comment <n> --body "$(cat <<'BODY' … )"`.

Two shapes account for most findings so far, and are worth looking for before
the reviewer does:

- **A guard that checks the form it anticipated rather than the property it
  claims** — a non-empty candidate id instead of a real one, a band's length
  instead of its position in time, an epoch boundary instead of one on
  somebody's clock, an enumerated list of pnpm subcommands instead of "uses
  pnpm".
- **A constant or comment standing in for enforcement** — `STATUSES_WITHOUT_WINDOWS`
  next to two independent fields, a doc comment promising a check "fails
  loudly" when nothing called it.

## Run (human path)

Same script by hand; `git switch -c` + `gh pr create --web` is the manual
equivalent. Nothing here is interactive except `gh auth login`.

## Test

`ticket.sh check` is the gate. It runs `git diff --check`, the design-canvas
drift check when `docs/design/` changed, and `pnpm check` — formatting, lint,
the brand/token/type/import/workflow checks, typecheck, unit tests, pgTAP and
the Playwright smoke suite.

```bash
.claude/skills/implement-linear-ticket/ticket.sh check
```

Read the **exit code**, not the tail of the output (working-process rule 2.1),
and never substitute a filtered `vitest run` for it: that does not typecheck the
tests.

## Gotchas

- **Local `main` is ahead of `origin/main`** (2 unpushed commits when this was
  written). `start` branches from local `main` in that case and says so; the PR
  diff on GitHub will then include those commits until `main` is pushed.
- **Untracked files travel across branches.** `start` only refuses on tracked
  changes; untracked files (`.gitignore`, `docs/tickets.md` at the time of
  writing) come with you and can end up in the ticket's commit if you `git add -A`.
  Add files by name.
- **Stacked PRs work.** Branch from the previous ticket's branch and
  `gh pr create --base <that branch>` so the diff is only the new ticket;
  merging the base retargets the child at `main` on its own. Rebase the child
  after every push to the base, and say in the body that it is stacked.
- **Linear branch names are long** and prefixed with the Linear username
  (`sushensatturu25/sus-69-…`). Use `gitBranchName` verbatim; do not invent one,
  Linear's PR auto-link depends on it.
- **`gh` cannot borrow git's keychain token.** The auto-mode classifier blocks
  piping `git credential fill` into `GH_TOKEN`; only `gh auth login` is
  acceptable, and it is interactive.
- **`pr` refuses ids that are not `ABC-123`** and refuses to run on `main`.
- **macOS has no `timeout`.** Nothing in the driver needs one, but do not add it.
- **`check` runs `corepack pnpm check`** (`pnpm` is not installed globally here;
  `corepack` ships with Node 24). It takes about six minutes, or about one for a
  change touching only Markdown and `.claude/` — those take the prose lane and
  skip the suites, `preview` and `deploy-dev` (SUS-72).

## Troubleshooting

- **`ticket.sh: working tree has uncommitted changes; commit or stash first`**:
  `start` found tracked modifications. Commit, stash, or `git checkout -- <file>`.
- **`gh is not authenticated. One-time setup…`, exit 2**: run the printed
  `gh auth login` line in a terminal, then re-run `pr`.
- **`ticket.sh: refusing to push main; run start first`**: you never branched.
- **`check: FAILED`**: read the section above it (`git diff --check` whitespace,
  `pnpm check`, or the design-canvas `differs:` list).

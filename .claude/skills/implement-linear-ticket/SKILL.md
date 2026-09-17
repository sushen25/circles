---
name: implement-linear-ticket
description: Work a Linear ticket end to end - fetch SUS-N from Linear, check its blockers, branch from main with Linear's branch name, implement it, run the repo checks, push, open a GitHub PR with gh, write testing notes on the PR and the ticket (walked by hand first), move the ticket to In Review, write findings onto the tickets that will act on them, and work the review rounds until one comes back clean. Use when asked to implement, work, pick up, start, or ship a Linear ticket / issue (SUS-6, S1-02, "the monorepo ticket"), to open the PR for one, or to address review findings on one.
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
   to decide goes in a Linear comment (step 10) and the PR body's "Decisions taken".
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
9. **Write the testing notes, and run them before you post them.** Both the PR
   and the Linear ticket get a **Testing notes** section, because the founder
   merges from one and reads the other. It says:

   - **What the automated tests cover**: each acceptance criterion, which test
     proves it (file and test name), and the command that runs just those.
     Say what they do *not* cover, and why.
   - **How to try it by hand**: setup (stack, env file, dev server), then
     numbered steps with exact URLs, exact text to type or tap, and exactly
     what should appear. Where the seed lacks something a step needs (an
     invite, a token, a verified contact), give the one SQL statement that
     makes it; nobody should have to work out a fixture to test a PR.
   - **What to check in the database** after a step that writes, as a query.
   - **Failure and edge states worth seeing**, and how to reach each.
   - **Known gaps**: what the reader will hit that is not this ticket's to fix,
     and which ticket owns it.

   **Walk the manual steps yourself, against the running stack, before
   posting** — scripting them in a throwaway Playwright spec is fine. Notes
   written from memory describe the code you meant to write. On S1-24 the first
   walk-through found a real bug that four review rounds and eighteen e2e tests
   had not: an invite opened in a tab already on `/join` changes only the
   fragment, the page does not reload, and the secret stayed in the address bar.
   A bug found this way is fixed like a review finding (failing test first) and
   gets a review round of its own.

   Post them as a PR comment (`gh pr comment <n> --body-file <file>`) and as a
   Linear comment, and **update both when a review round changes behaviour** the
   notes describe.
10. **Hand over in Linear.** `save_issue` with `id`, `state: "In Review"`,
   `links: [{url: <PR URL>, title: "PR #<n>"}]`. `save_comment` with
   `issueId: "SUS-N"` and a short body: PR link, decisions taken, anything left
   out and why. (Linear also auto-links the PR because the branch name is its
   `gitBranchName` and the title starts with the id.)
11. **Write the findings onto the tickets that will act on them**, not only this
    one. A comment here is read by nobody: whoever picks up the next ticket
    opens *theirs*. Anything a later ticket must do differently — a column that
    has to be nullable, a template that sends the wrong thing, a state the
    designs need — goes on that ticket, naming what to do and why. Blocking
    relations say something is pending, not what was learned.
12. **Report** to the user: PR URL, checks run, decisions, open questions, and
    where the testing notes are.
13. **Review**, below. The ticket is not done when the PR opens.

## Review

An adversarial review runs against the branch and the agent works the findings.
The ticket moves to Done only after the rounds are finished **and** the founder
merges.

### Who does the reviewing

**Codex first.** From the ticket's branch:

```
/codex:review --base <the PR's base>
```

The base is the PR's base, which for a stacked PR is the **previous ticket's
branch**, not `main` — a review against the wrong base reads the whole stack and
wastes the round. **Always run it in the foreground and wait**; never background
it, and never ask which to do.

**Then tell a clean round from a broken one, because they look alike and mean
opposite things.**

- *Codex reviewed the branch and found nothing* — a clean round. It ends the
  loop.
- *Codex did not review the branch* — "Reviewer failed to output a response",
  "Turn failed", or a usage-limit line naming a time it will be back. **This is
  not a clean round.** Nothing has been reviewed, and stopping here would hand
  over work nobody looked at. It has happened twice.

**On a broken round, fall back to the agent** rather than waiting for limits to
reset — unless the founder says to wait. Spawn it with the `Agent` tool and
`model: 'fable'`, in the foreground, and tell it:

- the PR number, the branch, and the base;
- what the change is trying to do, and which of its claims to attack hardest;
- to invoke **`review-ticket`** for the standards, the traps and the report
  format — do not retype the brief;
- where the previous rounds' findings are, when you are asking it to confirm
  them.

The two reviewers are not interchangeable, which is the other reason to keep the
fallback: Codex reads the diff, while the agent can reach the running database
and reproduce a claim. Findings from either are worked the same way, and a round
by either counts as a round.

`/code-review` is the built-in third option if both are unavailable.

### Working the findings

What follows holds whoever produced them.

**Every P0 and P1 is fixed, always.** There is no round budget for those and no
judgement call about them: if the reviewer marks a finding P0 or P1, either the
code changes or the finding is shown to be wrong, with the reproduction that
shows it. S1-05's P1 was a token interpolated into an exception message, which
means a token in a log — the kind of thing that is cheap now and unfixable
later.

**The stopping condition is a clean round, not a round count.** Ask for
another round after each fix, because findings surface in layers: S1-02 took two
rounds and S1-03 five, and two of S1-03's findings were only reachable once an
earlier fix had changed the shape of the code. S1-08's third round found two
P1s — and the review stopped there, because "three rounds" had been read as the
end. It is not. The rule, stated so it cannot be misread:

- **Review again after every round that found a P0 or P1**, however many rounds
  that takes. The review ends only when a round comes back with **no P0 and no
  P1**. A fix is not verified by making it; it is verified by the next round
  not finding it — and the next round is also the only thing that finds what
  the fix broke.
- **P2s stop being *fixed* after the third round**, because the returns fall
  off and a fourth round on a P2 that is really a preference costs more
  attention than it buys. They do not stop being *reviewed*: a P2 in round four
  is written up in the PR comment — what was found, why it was not done now,
  whether it belongs on a later ticket — rather than fixed. Ending on
  unaddressed P2s is a decision to state out loud, not a thing to do quietly.

So a ticket whose round three fixes a P1 gets a round four. If round four is
P2-only, write those up and stop; if it finds a P1, fix it and run round five.

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
tickets from step 11 and correct them. Three notes on SUS-31, SUS-42 and SUS-49
told later tickets to use a `TransitionError.message` that review then removed.

**Then reply on the PR** with what was found, what changed, what you pushed back
on, any P2 left open at round three and why, and the reproduction output. If a
fix changed anything the testing notes describe — a screen's text, a step, an
expected result — correct the notes on the PR and on Linear in the same pass.
`gh pr comment <n> --body "$(cat <<'BODY' … )"`.

**Two shapes account for most findings here**, and they are worth looking for
before the reviewer does — a guard that checks the form it anticipated rather
than the property it claims, and a constant or comment standing in for
enforcement. They are described with their examples in `review-ticket`, which is
where the reviewer reads them; one copy, so the two cannot drift apart.

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
- **A local gate that passes is not CI that passes.** CI runs gitleaks over
  the branch history, which `pnpm check` does not. A made-up UUID in a unit
  test failed CI on S1-24, and S1-14's JWT literal on every run. Build
  credential-shaped test values at runtime, and read `gh run list` after
  every push.
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

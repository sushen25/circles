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

1. **Fetch the ticket, and its comments.** Call `get_issue` with `id: "SUS-N"`,
   `includeRelations: true`, then `list_comments` with `issueId: "SUS-N"`.
   Use `title`, `description` (sections: Context, Read first, Scope,
   Implementation, Acceptance criteria, Tests, Out of scope), `gitBranchName`,
   `status`, `url`, `relations.blockedBy`. If the user gave an S-number, map it
   through `docs/tickets.md` first.

   **The description is the plan; the comments are what earlier tickets
   learned.** Step 11 below writes them, so a ticket that has been waiting for
   a while has several — SUS-42 had fourteen, including two that corrected an
   earlier one. Where a comment contradicts the description, follow the comment
   and say so in the PR body's "Decisions taken". On SUS-34 the comments were
   skipped and four of round one's five P1s were things SUS-27 and SUS-29 had
   already written there.
2. **Check blockers.** For every id in `relations.blockedBy`, `get_issue` it;
   all must be `Done` (or `Canceled`). Otherwise stop and report which block.
3. **Read first.** `AGENTS.md`, then everything in the ticket's "Read first"
   list, then `docs/tickets.md` "Working a ticket".
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

**The loop lives in `review-ticket`, under "The loop, for whoever runs the
review"** — who reviews first and what to fall back to, how to tell a clean
round from a broken one, when the loop ends, and how a finding is worked. It is
one copy on purpose: the reviewer and the author read the same file, so the two
cannot drift apart. Invoke `review-ticket` and read that section before the
first round; do not work from memory of it.

Two of its rules reach back into this skill's steps, so they are named here:
a fix that changes an exported shape or a documented behaviour means going
back to the notes step 11 left on later tickets, and a fix that changes
anything the testing notes describe means correcting them on the PR and on
Linear (step 9) in the same pass.

## Run (human path)

Same script by hand; `git switch -c` + `gh pr create --web` is the manual
equivalent. Nothing here is interactive except `gh auth login`.

## Local commands

`make` is the front door for everything local - `make dev`, `make dev-live`,
`make logs`, `make psql`, `make mail TO=…`, `make reset`, `make ports`.
Every target reads its ports out of the checkout's own `supabase/config.toml`,
so the same line works in the primary checkout and in a ticket worktree, and a
port written by hand is a port that will be wrong in one of them.
`docs/runbooks/local.md` explains each one. The gate is still `ticket.sh check`,
because it also checks whitespace and the design canvas; `make check` is the
`pnpm check` part of it alone.

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

- **If local `main` is ahead of `origin/main`**, `start` branches from local
  `main` and prints a `note:` line saying so; the PR diff on GitHub will then
  include those commits until `main` is pushed.
- **Untracked files travel across branches.** `start` only refuses on tracked
  changes; untracked files (a scratch SQL file, an unpublished skill) come with
  you and can end up in the ticket's commit if you `git add -A`. Add files by
  name.
- **Stacked PRs: set `TICKET_BASE`.** Both scripts read it (default `main`), so
  `TICKET_BASE=<previous ticket's branch> ticket.sh start <name>` branches from
  the base, `… ticket.sh check` diffs only this ticket, and `… ticket.sh pr`
  opens the PR against it with the same body as any other. Merging the base
  retargets the child at `main` on its own. Rebase the child after every push
  to the base, and say in the body that it is stacked. The review's `--base`
  is the same branch.
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

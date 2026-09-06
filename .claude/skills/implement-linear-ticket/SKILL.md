---
name: implement-linear-ticket
description: Work a Linear ticket end to end - fetch SUS-N from Linear, check its blockers, branch from main with Linear's branch name, implement it, run the repo checks, push, open a GitHub PR with gh, and move the ticket to In Review. Use when asked to implement, work, pick up, start, or ship a Linear ticket / issue (SUS-6, S1-02, "the monorepo ticket"), or to open the PR for one.
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
10. **Report** to the user: PR URL, checks run, decisions, open questions.

## Run (human path)

Same script by hand; `git switch -c` + `gh pr create --web` is the manual
equivalent. Nothing here is interactive except `gh auth login`.

## Test

There is no test suite in the repo yet (S0-01 adds `pnpm check`).
`ticket.sh check` is the gate; today it runs `git diff --check` and, when
`docs/design/` changed, the design-canvas drift check.

```bash
.claude/skills/implement-linear-ticket/ticket.sh check
```

## Gotchas

- **Local `main` is ahead of `origin/main`** (2 unpushed commits when this was
  written). `start` branches from local `main` in that case and says so; the PR
  diff on GitHub will then include those commits until `main` is pushed.
- **Untracked files travel across branches.** `start` only refuses on tracked
  changes; untracked files (`.gitignore`, `docs/tickets.md` at the time of
  writing) come with you and can end up in the ticket's commit if you `git add -A`.
  Add files by name.
- **Linear branch names are long** and prefixed with the Linear username
  (`sushensatturu25/sus-69-…`). Use `gitBranchName` verbatim; do not invent one,
  Linear's PR auto-link depends on it.
- **`gh` cannot borrow git's keychain token.** The auto-mode classifier blocks
  piping `git credential fill` into `GH_TOKEN`; only `gh auth login` is
  acceptable, and it is interactive.
- **`pr` refuses ids that are not `ABC-123`** and refuses to run on `main`.
- **macOS has no `timeout`.** Nothing in the driver needs one, but do not add it.
- **`check` is a placeholder until S0-01.** When `package.json` gains a `check`
  script it runs `corepack pnpm check` automatically (`pnpm` is not installed
  globally here; `corepack` ships with Node 24).

## Troubleshooting

- **`ticket.sh: working tree has uncommitted changes; commit or stash first`**:
  `start` found tracked modifications. Commit, stash, or `git checkout -- <file>`.
- **`gh is not authenticated. One-time setup…`, exit 2**: run the printed
  `gh auth login` line in a terminal, then re-run `pr`.
- **`ticket.sh: refusing to push main; run start first`**: you never branched.
- **`check: FAILED`**: read the section above it (`git diff --check` whitespace,
  `pnpm check`, or the design-canvas `differs:` list).

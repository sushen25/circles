---
name: work-tickets-in-parallel
description: Work several Linear tickets at the same time in the Circles repo - find the tickets whose blockers are all Done, pick a set that will not collide, give each one its own git worktree and its own local Supabase stack (a "slot"), run one agent per ticket through implement-linear-ticket, keep the gate to one run at a time, and land the PRs in an order that rebases cleanly. Use when asked what can be worked on next or in parallel, to work, start or ship two or more tickets at once, to set up a second local environment or worktree for a ticket, or to tidy up worktrees after a merge. For a single ticket in the main checkout, use implement-linear-ticket instead.
---

This skill schedules; it does not replace anything. Each ticket is still worked
by **`implement-linear-ticket`**, end to end, review rounds included. What this
adds is the part that skill cannot do from one checkout: somewhere separate for
each ticket to live, and the rules that stop two tickets treading on each other.

Two handles: the **Linear MCP tools** for the ticket side, and
`.claude/skills/work-tickets-in-parallel/parallel.sh` for worktrees and slots.
Paths are relative to the checkout you are in; the skill is tracked, so the
script is at the same relative path inside every worktree.

## Why one checkout is not enough

Three things are shared today, and each one breaks a second ticket silently:

- **The checkout.** `ticket.sh start` switches the branch under whoever else is
  working.
- **The database.** `supabase/config.toml` names one project (`circles`) on
  fixed ports, and `pnpm check` runs `supabase db reset`. A second gate wipes
  the first one's data mid-test.
- **The Edge runtime.** It bind-mounts the checkout that ran `db:start`. A
  second worktree sharing that stack has its functions served from the *other*
  branch, so a backend ticket passes or fails on code it did not write.

So a worktree alone is not isolation. Each parallel ticket gets a **slot**: its
own worktree, its own Supabase project (`circles-s1`, `circles-s2`, ...) and its
own ports, every one shifted by 100 x slot. Slot 0 is the primary checkout and
is never touched.

| slot | API | Postgres | Mailpit | app (Metro) |
|---|---|---|---|---|
| 0 (primary) | 54321 | 54322 | 54324 | 8081 |
| 1 | 54421 | 54422 | 54424 | 8181 |
| 2 | 54521 | 54522 | 54524 | 8281 |
| 3 | 54621 | 54622 | 54624 | 8381 |

Nothing has to remember those numbers. The `Makefile` works them out from the
checkout it is run in, so `make dev`, `make logs`, `make psql`, `make mail` and
the rest mean this slot's stack inside a worktree and the founder's stack in the
primary checkout. `make ports` prints the project and the ports it worked out,
which is also the quickest way to tell which checkout a shell is in.

## Prerequisites

Everything `implement-linear-ticket` needs, plus:

- **Docker with memory to spare.** A slot's stack starts with CI's exclusion
  list (no realtime, storage, studio, logflare, vector, supavisor) and still
  wants roughly 1.5 GB. Two slots beside the primary stack is comfortable on a
  16 GB machine; the default cap is three (`PARALLEL_SLOTS`).
- `perl` (ships with macOS) for the config patch.
- `gh` authenticated, for `overlap`.

## Run (agent path)

| command | what it does |
|---|---|
| `parallel.sh add <gitBranchName> [--base <ref>] [--no-install]` | takes the first free slot; `git worktree add ../circles-wt/sus-N` on the ticket's branch (created from `main` by the same rule as `ticket.sh start`, or from `--base` for a stacked ticket); patches that worktree's `config.toml` and marks it skip-worktree; copies `.env`; `pnpm i` and `pnpm build` |
| `parallel.sh up` / `down` | in a worktree: start or stop this slot's stack. `up` is `make up` plus `make env`, so the app env is written for this slot, and it prints the `make` commands for the dev server and the mail catcher |
| `parallel.sh gate` | in a worktree: `ticket.sh check`, holding a lock in the shared `.git` so only one gate runs at a time; a lock left by a dead process is cleared |
| `parallel.sh sync [<ref>]` | in a worktree: take the patch off, rebase on `origin/main` (or `<ref>`), put the patch back |
| `parallel.sh unslot` / `repatch` | in a worktree: take the patch off `config.toml` so a real change to it can be committed, then put it back |
| `parallel.sh overlap <path>...` | which open PRs touch these paths or prefixes |
| `parallel.sh list` | every slot: ticket, branch, behind/ahead of `origin/main`, and who holds the gate |
| `parallel.sh rm <sus-n> [--force]` | stop the stack and drop its data, remove the worktree, free the slot; keeps the branch; refuses on uncommitted or unpushed work without `--force` |

Steps, in order:

1. **Find the ready set.** `list_issues` with `project: "Circles MVP"` and
   fields `id, title, status, priority, projectMilestone`. For every ticket in
   Backlog or Todo in the current slice, `get_issue` with
   `includeRelations: true`. A ticket is **ready** when every `blockedBy` is
   `Done` or `Canceled`. Note what is `In Progress` or `In Review` as well:
   those are the branches a new ticket can collide with.
2. **Set aside what an agent cannot do alone.** Vendor accounts, store
   credentials, anything whose first step is the founder signing in somewhere
   (SUS-77 is the pattern). List them as ready-but-yours, do not spawn them.
3. **Choose the set.** Order by what unblocks the most (`relations.blocks`,
   followed down the chain to the slice's release ticket), then priority. Then
   throw out collisions:
   - Work out the paths each ticket will touch from its Implementation section
     (`apps/app/src/features/<x>`, `supabase/functions/<y>`, `supabase/sql`,
     `packages/domain/src/<z>`), and run `parallel.sh overlap` on them against
     the open PRs.
   - Two tickets that build the same screen or the same function are **stacked
     or queued, never parallel**. "Related" in Linear is a hint to look, not a
     verdict.
   - A ticket that moves or renames something everyone imports (the copy
     package, `components/`, a domain module's exports) runs **alone, first**.
     Land it, then fan out.
   - At most one ticket in the set may add migrations or SQL functions. The
     generated functions migration (ADR 0015) and `db.generated.ts` do not
     merge; two branches that both regenerate them guarantee a conflict.
   - No more tickets than free slots.
4. **Say what you chose and why, then wait for the founder's go-ahead** before
   spawning anything: the set, what was left out and the reason, the merge
   order you expect. Agents running for an hour on the wrong three tickets is
   the expensive mistake here.
5. **Make the slots.** From the primary checkout, once per ticket:

```bash
.claude/skills/work-tickets-in-parallel/parallel.sh add sushensatturu25/sus-38-s1-22-client-first-time-organiser-flow-welcome-email-code
```

   Expected: `worktree:`, `branch:`, `slot: 1 · api 54421 · db 54422 · mail 54424 · app 8181`.
   Use Linear's `gitBranchName` verbatim; the worktree directory is the `sus-N`
   inside it. A stacked ticket takes `--base <the previous ticket's branch>`.
6. **Claim in Linear, with the slot.** `save_issue` to `In Progress`, and a
   `save_comment` naming the worktree path and slot. Linear is the lock: a
   ticket that is In Progress with a slot comment is somebody's.
7. **Spawn one agent per ticket, all in one message** so they run together.
   Use the `Agent` tool **without** `isolation: "worktree"` - that would make a
   second, slotless worktree. The brief for each:
   - the ticket id, the worktree path, the slot and its ports;
   - "work entirely inside that path; never `cd` to the primary checkout and
     never run `ticket.sh start`, the branch already exists";
   - "invoke `implement-linear-ticket` and follow it, with the substitutions in
     the next section";
   - the shared-file rules below, and which other tickets are running beside it
     and what they own.
8. **While they run**, this session is the only one that talks to the founder.
   Relay questions, and watch for a merged PR: when one lands, tell every other
   agent to run step 10 (`SendMessage` to the agent; do not run it in their
   worktree yourself).
9. **Report PRs in merge order**: smallest blast radius first, anything others
   are stacked on before its children, the migrations ticket before tickets
   that read its types.
10. **After each merge**, the agent working each remaining worktree runs, in
    its own worktree — not the orchestrator, whose `sync` would refuse on the
    agent's uncommitted work or rebase under a running gate:

```bash
.claude/skills/work-tickets-in-parallel/parallel.sh sync
corepack pnpm gen:functions && corepack pnpm gen:types   # only if the merge touched SQL
.claude/skills/work-tickets-in-parallel/parallel.sh gate
```

   then `git push --force-with-lease`, and check `gh pr view <n> --json headRefOid`
   against `git rev-parse HEAD` as `implement-linear-ticket` says.
11. **Clean up** once a ticket's PR is merged and the ticket is Done:
    `parallel.sh rm sus-38`. The stack's data goes with it; the branch stays.

## What changes inside implement-linear-ticket

Everything in that skill holds except:

| its step | in a slot |
|---|---|
| 5. Branch (`ticket.sh start`) | skip; `parallel.sh add` made the branch and the worktree |
| before 6. Implement | `parallel.sh up` once, from the worktree |
| 7. Check (`ticket.sh check`) | `parallel.sh gate` - the same check, behind the lock. Read the exit code. A wait of several minutes for another ticket's gate is normal, not a hang |
| 9. Testing notes | walk them here, **write them as `make` targets** (`make reset`, `make dev`, `make mail TO=…`), which read the right ports wherever the founder runs them. Where a URL has to be spelled out, use the primary checkout's ports — app 8081, API 54321, Mailpit 54324, what `make ports` prints *there* — and say so in one line at the top ("`make ports` names yours if they differ"): the founder tests from the primary checkout after merge, and a note that says 8181 sends them to a server that is not running |
| 9. `pnpm mail` | `make mail TO=someone@example.com` |
| every other local command (`dev`, `dev-live`, `logs`, `psql`, `sql`, `reset`, `status`) | the **same `make` target as in the primary checkout**. The Makefile reads this worktree's own `supabase/config.toml`, so every port and container name follows the slot; `make ports` prints them. Never pass a port by hand, and never edit `config.toml` to change one |
| Review | `codex review --base <base>` from inside the worktree, then the loop in `review-ticket` ("The loop, for whoever runs the review"); a stacked ticket's base is still the previous ticket's branch |

`ticket.sh check`, `push`, `pr` and `status` all work unchanged from inside a
worktree.

## Files every ticket wants

- **ADR numbers.** Two branches will both reach for the next number. Draft as
  `docs/decisions/00XX-<slug>.md`, refer to it as "ADR 00XX" in the PR, and
  take the real number in the final rebase before merge, when main says what is
  next. Update `docs/decisions/README.md` in that same commit.
- **`apps/app/src/copy/en.ts`.** Add keys only inside your feature's own
  namespace and never reorder or reformat a neighbour's. Two tickets adding to
  different namespaces then merge clean.
- **`apps/app/src/features/manifest.ts`, `docs/tickets.md`, the canvas
  mapping.** One line per ticket, added at the position the file's order
  dictates, not at the end.
- **Generated files** (`db.generated.ts`, the functions migration,
  `packages/tokens/src/generated.ts`, `docs/design/*.dc.html`). Never resolve a
  conflict in one by hand. Take main's, regenerate, commit.
- **`supabase/config.toml`.** In a slot it is patched and hidden from git, so
  an edit made there is *never committed*. A ticket that adds an Edge Function
  needs a `[functions.<name>]` block: `parallel.sh down`, `parallel.sh unslot`,
  edit, commit, `parallel.sh repatch`, `parallel.sh up`.
- **`supabase/functions/import_map.json` and `pnpm-lock.yaml`.** A new
  dependency in two branches conflicts in both. Say so in step 4 and queue one
  behind the other.

## Test

`parallel.sh gate` is `ticket.sh check` behind a lock, so the gate is the same
gate. To check the driver itself without Docker or a ticket:

```bash
.claude/skills/work-tickets-in-parallel/parallel.sh add sushensatturu25/sus-0-slot-smoke-test --no-install
git -C ../circles-wt/sus-0 diff --stat            # empty: the patch is hidden
grep -n 'project_id\|^port' ../circles-wt/sus-0/supabase/config.toml   # circles-s1, 544xx
.claude/skills/work-tickets-in-parallel/parallel.sh list
.claude/skills/work-tickets-in-parallel/parallel.sh rm sus-0 --force && git branch -D sushensatturu25/sus-0-slot-smoke-test
```

## Gotchas

- **Two slots beside the primary is the proven shape.** Slots 1 and 2
  (`circles-s1` on 54421, `circles-s2` on 54521) ran side by side on 22
  September 2026 with the primary stack still answering on 54321, and SUS-42
  and SUS-45 were worked to merge-ready in them two days later, seven review
  rounds each. A third slot has not been tried; `make envs` shows what is
  running before you add one.
- **The gate is serial on purpose.** The stacks are isolated, but both
  Playwright configs serve on fixed ports (8082, 8083) and Metro's cache is per
  checkout, not per port. Three tickets means a gate can wait twelve minutes.
  Making `playwright.config.ts` and `playwright.live.config.ts` read their port
  from the environment would lift this; until then do not pass around the lock.
- **The primary checkout is slot 0 and is the founder's.** Do not spawn an
  agent into it while parallel work is running, and do not run `pnpm check`
  there outside the lock either: it uses the same Playwright ports. If the
  primary has to gate, run it while no slot is gating (`parallel.sh list` shows
  the holder).
- **`add` refuses a branch that is checked out elsewhere**, which includes the
  primary. Switch the primary to `main` first if it is sitting on the ticket's
  branch.
- **Untracked files do not travel into a worktree**, the reverse of
  `ticket.sh start`. `.env` is copied; anything else local (a scratch SQL file,
  an unpublished skill) has to be copied by hand.
- **A new file in `packages/*/dist` still needs a stack restart**, per slot:
  `parallel.sh down && parallel.sh up`. `add` builds before the first `up` for
  this reason.
- **`EXPO_PUBLIC_*` is inlined and Metro does not key its cache on it.** A
  worktree has its own Metro cache, so slots do not poison each other, but
  switching one worktree between fixtures and its stack still needs `--clear`.
- **gitleaks reads history on every branch.** Three agents are three chances
  to commit a credential-shaped test value. The rule in
  `implement-linear-ticket` applies to each; read `gh run list` per PR.
- **Codex usage limits are shared.** Two tickets reviewing at once reached the
  limit at round five on both (SUS-42, SUS-45); three would reach it sooner. A
  usage-limit line is a broken round, not a clean one, and the agent reviewer
  is the expected path for the later rounds, per ticket — `review-ticket` has
  the rule.
- **Worktrees live beside the repo** (`../circles-wt/`), not inside it, so
  ESLint, Prettier, Vitest and Metro never see a second copy of the source.
  `PARALLEL_ROOT` moves them.
- **Do not `git worktree remove` by hand.** The slot file stays behind and the
  stack keeps running. `parallel.sh rm`; if it was already done by hand,
  `parallel.sh rm sus-N --force` clears the stale slot.

## Troubleshooting

- **`all 3 slots are taken`**: `parallel.sh list`, then `rm` the merged ones.
- **`this is the primary checkout (slot 0)`**: `up`, `gate`, `sync` run from
  inside a ticket worktree.
- **`gate: waiting for <pid> <path>`** for longer than a gate takes: check the
  pid is a live `parallel.sh`; if the machine slept mid-gate, kill it and the
  next `gate` clears the lock.
- **`supabase start` says a port is allocated**: another slot's stack, or a
  stack from a worktree removed by hand. `docker ps --filter name=circles-s`
  shows which; `supabase stop --project-id circles-s<N> --no-backup` stops it.
- **The rebase stopped inside `sync`**: resolve, `git rebase --continue`, then
  `parallel.sh repatch`. Until `repatch` runs the worktree points at the
  primary stack's ports.
- **Functions return `BOOT_ERROR` in one slot only**: a module was added to
  `packages/*/dist` after that slot's stack started. `down`, `up`.

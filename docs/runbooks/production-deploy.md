# Production deploy

How `deploy-prod` is run: the backup first, then the dispatch, then reading the
plan before approving. Written by SUS-105. The release checklists
([Release: Slice 2](./release-slice-2.md) and its successors) say *what* a
particular release contains; this says how any release is put on `circles-prod`.
**Nothing here has been run against the hosted project by an agent.** The
commands are for you to run.

`circles-prod` is on the Free plan, which has no backups
([architecture §18](../technical-architecture.md) asks for a dump before Pro).
Rollback for a migration is a compensating migration, and two of Slice 2's
migrations are not transactional. So the dump below is the only way back.

## 1. Take the backup

**Before you dispatch, every time.** It is a manual step on purpose. The
repository is public, so a workflow artifact is downloadable by anyone, and an
artifact holding production data is not acceptable (SUS-105, after the
2 October decision that the repository stays public). The workflow cannot take
it for you; it refuses a dispatch that does not say you did.

From a scratch copy of `supabase/`, so `link` does not leave your checkout
aimed at production (`supabase/.temp` holds the linked ref; see the note in
[CI](./ci.md), "Rotating them"). Docker must be running, because the CLI runs
`pg_dump` in a container. The database password is the one from
Supabase → Project Settings → Database.

```bash
d=$(mktemp -d) && cp -R supabase "$d/" && cd "$d"
read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
read -rs SUPABASE_DB_PASSWORD && export SUPABASE_DB_PASSWORD
SUPABASE=~/Repos/circles/node_modules/.bin/supabase
$SUPABASE link --project-ref <circles-prod project ref>
stamp=$(date -u +%Y%m%dT%H%M%SZ)
$SUPABASE db dump --linked -f "circles-prod-$stamp-schema.sql"
$SUPABASE db dump --linked --data-only --use-copy \
  -s auth,public,private,analytics,jobs,planning -f "circles-prod-$stamp-data.sql"
$SUPABASE db dump --linked --role-only -f "circles-prod-$stamp-roles.sql"
```

The schema dump covers every schema the CLI includes by default; the data dump
names ours (`public`, `private`, `analytics`, `jobs`, `planning`) and `auth`
because `--data-only` is otherwise limited to what the CLI considers user data,
and the application tables (`profiles`, `circles`, memberships) reference
`auth.users`: without it, saved accounts cannot be restored with their
foreign keys intact.

**Restoring** is not rehearsed. The order to try is the roles file, the schema
file, then the data file with `auth` before the application schemas, so the
foreign keys to `auth.users` resolve. **Do a restore into a scratch local
project once before relying on any of this** (`make reset` shows what a clean
one looks like), and write down what you had to change here.

Then:

1. **Store the files somewhere private and encrypted**, not in the repository,
   not in a workflow artifact, not in a PR or a ticket. They hold contact
   details and sign-in material. An encrypted volume or
   your password manager's file storage will do. Name the files by the
   timestamp above.
2. **Check they are not empty**: `wc -l circles-prod-*` and `grep -c 'COPY '
   circles-prod-*-data.sql` (it should be more than the number of tables with
   rows).
3. **Do not leave a copy on a laptop you do not control**, and delete the
   scratch directory (`rm -r "$d"`).

Keep the last backup until the release after it has been checked
(see *After the deploy* in the release checklist).

## 2. Dispatch

GitHub → Actions → `deploy-prod` → Run workflow, on `main`.

- `confirm`: `deploy`.
- `backup`: `backed-up`, once step 1 is done. Anything else fails the `plan`
  job before it does anything.

## 3. Read the plan, then approve

The run has two jobs.

**`plan`** has no environment, so it starts at once and nothing waits for it.
It fails, and the approval prompt never appears, when:

- the `check` run for the dispatched commit is not a **success**. No run,
  queued, in progress, cancelled, timed out and failed all refuse. If the check
  is still running, wait for it and dispatch again;
- `confirm` or `backup` is wrong.

It writes to the run summary:

- **the migrations to apply**, from the commit production was last deployed
  from to this one, with the ones that apply **statement by statement** (no
  `begin` … `commit`) marked, and the Edge Functions that change. A migration
  edited after it was applied is marked too: the gate refuses those on `main`,
  so one showing here needs explaining before anyone approves;
- a short list of what to confirm before approving.

The list comes from git and GitHub's deployments, not from the database: the
exact plan is `supabase db push --dry-run`, and that needs the production
access token, which only a job that has been approved can read
([CI](./ci.md), "Deploy credentials"). The dry run runs first in the approved
job and prints the CLI's own list.

**`apply`** is in the `production` environment and `needs: plan`. Its required
reviewer is the approval. Read the summary of `plan`, then approve or reject.
Rejecting stops the run with nothing changed.

If you are dispatching *and* approving (the only reviewer is you), the point is
the same: the plan is written before you are asked.

## 4. After it lands

Run the checks in the release checklist's *After the deploy*. If the push
failed inside a non-transactional migration, that section says what to look at
first; the backup from step 1 is what you restore from if the compensating
migration cannot be written in time.

## What is still on you

- The `production` environment's required reviewer and its `main`-only branch
  policy are GitHub settings. `check:workflows` cannot see them.
- `enforce_admins` and "require branches to be up to date" on `main` are
  founder settings, and are recorded in [CI](./ci.md), "Branch protection".

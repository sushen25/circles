# Production deploy

How `deploy-prod` is run: the backup first, then the dispatch, then reading the
plan before approving, what the run does after it lands, and how to go back.
Written by SUS-105; the tags, the smoke test and the rollback are SUS-144. The release checklists
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
- `rollback_to`: leave empty. Only a rollback fills it in (see "Rolling back"
  below).

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

`apply` ends with two checks of the live site, so a deploy that landed badly
ends **red**. The deploy has already happened by then; red is how you find out.

- `scripts/smoke-web.mjs` fetches `/start` (the app shell and its bundle, not the
  marketing page that the bare host serves since ADR 0052) and the preview card
  of `/j/abc234` as a chat app would. The card's `og:image` and its refresh must
  be on `EXPO_PUBLIC_APP_ORIGIN`, never the per-deployment `*.expo.app` host
  (SUS-128). It retries for two minutes while the CDN catches up.
- `pnpm check:env <host>`: HTTPS, HSTS, the app's `Referrer-Policy`, SPF, DKIM,
  the bounce MX and DMARC.

If both pass, a third job, `tag the release`, pushes the tag
**`prod-<yyyymmdd>-<shortsha>`** (UTC date, first seven characters of the
commit) on the deployed commit and names it in the run summary. It is the only
job with `contents: write`, and it reads no secret. A red smoke test means no
tag: the release is live but unverified, so decide between fixing forward and
rolling back to the previous tag, and look at what is live with
`git tag -l 'prod-*'` against the run history.

Then run the checks in the release checklist's *After the deploy*. If the push
failed inside a non-transactional migration, that section says what to look at
first; the backup from step 1 is what you restore from if the compensating
migration cannot be written in time.

**What is live.** `git fetch --tags && git tag -l 'prod-*' --sort=-creatordate |
head` lists releases, newest first. After a normal deploy the newest tag is
live. After a **rollback** it is not: a rollback makes no tag, and GitHub's
Deployments (Code → Deployments → `production`), which `plan` reads, records the
commit the workflow was *dispatched* on, not the tag it redeployed. So after a
rollback the run summary ("Rolled back to …") is the record, and you should
write the tag down. The next normal deploy puts live what it is dispatched on
and tags it again.

## Rolling back

A rollback is "redeploy code that worked, against the schema as it is now". It
is one dispatch.

**What it does.** Dispatch `deploy-prod` on `main` with `rollback_to` set to a
tag from `git tag -l 'prod-*'`, and `confirm` and `backup` as usual. `plan`
resolves the tag to its commit and refuses unless the tag is one of ours
(`prod-<yyyymmdd>-<7 hex>`), still points at the commit its name says, and that
commit is an ancestor of the dispatched one. It then runs the same `check`
refusal as any deploy, on that commit. Its summary, "Rollback plan", lists the
migrations the database has that the old code has never seen: those the last
successful deployment carried and, separately, those a deployment that failed
after migrating (at the smoke test, say) may also have applied. The second list
is a possibility, not a fact: the repository cannot see the production
database. `apply`, after
the approval, checks out the tag's commit and deploys its Edge Functions and its
web build with the tag's own `EXPO_PUBLIC_BUILD_ID`. It **applies no migration**
and does not dry-run any: `db push` refuses a database that has migrations the
checkout lacks. No new tag is made; the summary says which one is live again.
The smoke test and `check:env` run as for any deploy.

**Before approving, read both migration lists.** The old code runs against the
newer schema. That is safe over an additive migration (a new table or column, a
new function) and unsafe over a rename, a drop, a tightened constraint or a
changed function signature the old code calls. If it is unsafe, a rollback of
the code makes it worse; the answer is a fix-forward, or a compensating
migration written and shipped as a normal deploy.

**What cannot be rolled back.**

- **Migrations.** They are forward-only. The backup from step 1 is the only way
  to undo data, and restoring it is not rehearsed (step 1).
- **Side effects.** Emails and push notifications already sent, cron jobs that
  already ran, and rows written by the new code while it was live.
- **Secrets and settings** changed in Supabase, EAS or the `production`
  environment between the two releases: the old code runs with the new values.
- **EAS Update channels** (native, Slice 3) have their own rollback and are not
  touched by this.

**Afterwards.** Read the smoke test summary, run *After the deploy* from the
release checklist, and then fix forward on `main`. The next deploy's plan diffs
from the last successful deployment, which is now the rolled-back commit, so it
lists the migrations production already has as if they were new. `db push`
skips what the database has recorded, so they are not applied twice; the
dry-run in `apply` prints the CLI's own list, which is the one to trust.

### Walking it once

Nothing in this workflow has been dispatched by an agent, and `deploy-prod`
cannot target dev (it is the `production` environment, with the `*_PROD_*`
secrets). The first walk is therefore a no-op rollback on production, which
changes nothing but proves the path:

1. After the first deploy that creates a tag, dispatch `deploy-prod` again with
   `rollback_to` set to that tag, which is also the newest release. Read the
   "Rollback plan": both migration lists should say none.
2. Approve. The run should end green after `smoke-web.mjs` and `check:env`, and
   `tag the release` should say it made no new tag.
3. `git tag -l 'prod-*'` should be unchanged, and Deployments should show a new
   `production` entry on the commit you dispatched from (which, in this walk,
   is the tagged one).
4. Dispatch with `rollback_to` = `prod-20260101-0000000` (a tag that does not
   exist) and with a branch name. Both must fail in `plan`, before the
   approval prompt.

## What is still on you

- The `production` environment's required reviewer and its `main`-only branch
  policy are GitHub settings. `check:workflows` cannot see them.
- The tag job pushes with the workflow's own token, so a ruleset that blocks tag
  creation by `github-actions` would stop it. None exists today.
- `enforce_admins` and "require branches to be up to date" on `main` are
  founder settings, and are recorded in [CI](./ci.md), "Branch protection".

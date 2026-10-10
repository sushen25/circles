# CI

Three GitHub workflows and two EAS ones. `check` is the only one that gates a
merge; the rest deploy.

## `check` — the gate

Runs on every pull request and on `main`. It runs **exactly `pnpm check`**,
because a CI that checks something different from the local command is one
people learn to ignore (architecture §16). Since SUS-179 it runs it as jobs
side by side, because one job took 27 of its 30 minutes and the live suite was
15 of them.

`pnpm check` is three parts, and each is a script in the root `package.json`:

| Part | What it is | CI job |
|---|---|---|
| `check:static` | Prettier, lint, the small checks (brand, tokens, imports, migrations, transitions, events, functions, workflows, docs), typecheck, unit tests. No database. | `static` |
| `check:stack` | pgTAP (`db:test`), the integration suite, `check:types`, the smoke suite. Needs the local Supabase. | `database` |
| `test:e2e:live` | The journeys against the local stack in five browser projects. | `live (1/2)` and `live (2/2)` |

`scope` runs first and alone: gitleaks, then the change's kind
(`scripts/ci-scope.mjs`). Every other job `needs` it. A Markdown-only change runs
`scope` and `static` (Prettier and the docs check) and skips `database` and
`live` on purpose.

| Step | Why |
|---|---|
| gitleaks (`scope`) | First, before the build. Finishing a build before reporting a leaked secret helps nobody. |
| `pnpm install --frozen-lockfile` | Catches a lockfile that was never updated — it has already caught one. |
| Playwright browsers | Cached on the lockfile hash. The system libraries are not, and `scripts/playwright-deps.sh` installs them (see "The apt step"). |
| `supabase start` | `database` and each live shard start their own stack: database only, no studio or realtime. |
| `pnpm run check:static`, `check:stack`, `test:e2e:live --shard=i/2` | The gate, a part to a job. |

### One verdict, and what it is named

`deploy-dev`'s wait, `deploy-prod`'s plan and the branch protection on `main`
all read one check run, named **`check`**. It is the last job of the workflow:
it `needs` every other job, runs `if: ${{ always() }}` and runs
`scripts/check-verdict.mjs`, which is green only when `scope`, `static`,
`database` and `live` all **succeeded**. Cancelled, timed out, skipped and
missing are all red, with one exception: on a prose-only change `database` and
`live` were skipped on purpose.

`if: always()` is the line that matters. Without it, a failed suite job makes
`check` *skipped*, and a required check that was skipped counts as passing.
Unit tests going green under the name `check` while the live suite is red or
still running is the failure this shape exists to prevent, so `check:workflows`
holds it in place: `check` needs every other job, has `always()`, runs the
verdict script unconditionally, nothing else in `check.yml` is called `check`,
no suite job may `continue-on-error`, every job has a `timeout-minutes` of 20
or less, CI runs every part of `pnpm check` and no `pnpm run` that is not one,
and the live job's shards are all of `1/N` to `N/N`. The tests for it are
mutations: `scripts/ci-gates.test.mjs` takes each of those out of a copy of
`check.yml` and expects `check:workflows` to fail.

**The `check` run does not exist until the suites finish.** GitHub creates a job's
check run when the job is scheduled, and `check` is scheduled last. For the ten
minutes in between a commit has jobs named `static`, `database` and `live (1/2)`
and no `check`, which `scripts/green-check.mjs` used to read as "no run":
`deploy-dev` gives that five minutes of grace and then refuses. So
`green-check.mjs` now also lists the commit's runs of `check.yml`
(`actions: read`, beside `checks: read`) and calls the commit *pending* while
one has not finished. A re-run is pending the same way, where the previous
attempt's `check` run would otherwise decide. On the branch's own run:
`green-check: refusing …: the check.yml workflow is in_progress, so its check job has no verdict yet`.

**Branch protection needs no change.** It requires the status context `check`,
and the job named `check` is that context. While the suites run the context is
"expected", as it was while the old single job ran.

### What it costs

Measured from real runs of this change (SUS-179, PR #164); the before column is
the architecture review's 60 runs of 9 October 2026.

| Job | Before (one job) | After |
|---|---|---|
| `scope` | inside the job | RUN1_SCOPE |
| `static` | about 4.4 min of the job | RUN1_STATIC |
| `database` | about 6 min of the job | RUN1_DB |
| `live (1/2)`, `live (2/2)` | 15.6 min of the job | RUN1_LIVE |
| `check` | — | RUN1_CHECK |
| **Run, wall clock** | **27.2 min median** (p90 28.1, max 28.6) | **RUN1_WALL** |

OBSERVED_PLACEHOLDER

The live suite is 372 runs now, not 556: Chromium and WebKit run every spec, and
the two in-app-browser projects and the en-AU one run only the specs that say they
need them.

### Which live specs run where

Each `tests/e2e-live/*.spec.ts` says what it depends on in a comment on its first
lines, and `playwright.live.config.ts` builds the three optional projects from
it (`tests/e2e-live/scopes.ts`):

```ts
// @e2e: core
// @e2e: in-app-browser
// @e2e: in-app-browser, locale
```

| Tag | Runs in | For a spec that |
|---|---|---|
| `core` | `android-chrome` (Chromium), `iphone-safari` (WebKit) | does not depend on which app opened the link or on the browser's locale. Every spec runs here, whatever it says. |
| `in-app-browser` | also `whatsapp-android`, `messenger-ios` | meets the user agent: the in-app guard, the share sheet, being sent back in after storage was cleared, a link opened inside a chat, the touch editor in a WebView. |
| `locale` | also `iphone-safari-en-au` | writes dates, or is a page a chat link lands on (a browser in another locale than the export's must hydrate cleanly, SUS-90). |

Currently `in-app-browser` is `availability`, `continuity`, `first-run`, `guest`,
`join`, `link-preview` and `plan-link`; `locale` is `availability`,
`candidates`, `confirmation`, `guest`, `join`, `plan-link`, `served-html` and
`zone-note`; the other 20 are `core`. **A new spec must say.** With no line,
`pnpm check:workflows` fails and names the file and the three choices; a spec
tagged `core` whose code reads the user agent, the share sheet or the second
locale fails too. An untagged spec would otherwise run in two of five projects
and nobody would see it was missing from the other three. If you rebase onto
this and a spec of yours is named, that is the check working.

### The apt step

`playwright install-deps` sat in its apt step until the job's 30-minute timeout
twice (SUS-143), on a step that takes under a minute. `scripts/playwright-deps.sh`
gives each attempt three minutes, kills it and tries again, three times, with
`dpkg --configure -a` between; the step has a 12-minute limit of its own, and
the hang costs three minutes instead of the run. It is a retry and not a fix for
whatever hangs apt: if it fires, the log says `did not finish (attempt n of 3)`.
The system libraries cannot be cached (apt owns them), and they are 30 to 60
seconds of a live job.

### When it fails

A failed `database` or `live` job uploads `playwright-report/` (the HTML report
for the smoke and live suites, under `smoke/` and `live/`) and `test-results/`
(traces, kept on the first retry, and failure screenshots) as the artefacts
`playwright-report-smoke` and `playwright-report-live-<n>`, for seven days.
Download one and `pnpm exec playwright show-report playwright-report/live`.
The repository is public, so an artefact is downloadable by anyone: the suites
run against a local stack with seeded people, and no secret is in a trace.

Each live shard writes its run count and minutes to the job summary
(`scripts/live-summary.mjs`), per project, so growth shows on the run's page
before it shows on the clock.

**It blocks what it should.** Verified on a throwaway PR: a `react` import in
`packages/domain` fails with `domain is not allowed to import "react"
(architecture §7.2)`, and editing `gen.py` without regenerating fails with
`check:tokens: generated.ts is stale`.

**Two workflows run per push.** When reading a result, name the one you mean —
`preview` passes trivially while there is no `EXPO_TOKEN`, and mistaking it for
`check` gives a green tick that means nothing.

## `deploy-dev`, `deploy-prod`, `preview`

**All three work.** A merge to `main` deploys `dev` once its `check` has
passed, a PR gets a preview URL, and `deploy-prod` has run against production
since 3 October 2026.

### `deploy-dev` waits for `check`

`check` and `deploy-dev` start in the same second on the same push, so
`deploy-dev` has a first job, `wait-for-check`, that polls the checks API for
the commit's `check` run (`scripts/green-check.mjs --wait`) and a second, `deploy`,
that `needs` it. The wait is up to 40 minutes (the longest a run can take is its slowest
job's 15-minute limit plus the ones before it, and it was a single 30-minute
job until SUS-179), and a commit with no `check` run at all gets five minutes to
get one. A failed, cancelled or timed-out check fails the wait and nothing is
deployed. A manual dispatch waits too. Until SUS-105 a formatting failure on
29 September and a cancelled run on 2 October both reached dev.

A Markdown-only push still does not start `deploy-dev` (`paths-ignore`), so it
has no wait to pass.

### How the check conclusion is looked up

`scripts/green-check.mjs` first calls `GET /repos/{repo}/actions/workflows/check.yml/runs?head_sha={sha}`
(`actions: read`): a run that has not finished makes the commit *pending*, because
the `check` job is the last of its workflow and does not exist yet. Then it calls `GET /repos/{repo}/commits/{sha}/check-runs`
with the workflow's own token (`checks: read`) and keeps the runs named `check`
that **GitHub Actions** created, because any app can create a check run with any
name. The latest by start time decides, so a re-run replaces the run before it.
Only a **completed `success`** is green. Everything else is not: no run,
queued, in progress, cancelled, timed out, skipped, neutral and failure. In
`deploy-prod` that is an immediate refusal; in `deploy-dev` queued and in
progress are waited out and the rest refuse.

### `deploy-prod` is three jobs

`workflow_dispatch` only. See [Production deploy](./production-deploy.md) for
the steps a person takes.

| Job | Environment | What it does |
|---|---|---|
| `plan` | none | Refuses a dispatch without `confirm: deploy` and `backup: backed-up`; refuses a commit whose `check` is not green; writes the pending migrations and functions to the run summary (`scripts/prod-plan.mjs`) |
| `apply` | `production`, `needs: plan` | The required reviewer's approval; then the missing-secret check, the dry run, migrations, functions and the web build, and last a smoke test of the live site (`scripts/smoke-web.mjs`, `pnpm check:env`). With `rollback_to` it deploys that tag's commit and skips the migrations |
| `tag` | none, `needs: plan, apply` | Pushes `prod-<yyyymmdd>-<shortsha>` (`scripts/release.mjs`). The only job with `contents: write`; it reads no secret and runs only after the smoke test passed |

The approval prompt therefore comes after the plan is readable and the commit is
known to be green. `plan` has no environment, so it cannot read the production
secrets and cannot run `db push --dry-run`; its list is built from git and the
`production` deployments (the commit last deployed, to this one). The dry run
still runs, first in `apply`.

**The backup is a manual step, not an artifact.** The repository is public,
so a workflow artifact is downloadable by anyone, and one holding production
data is not acceptable. The workflow only checks that the dispatcher confirmed
it (`backup: backed-up`); the command and where to put the files are in
[Production deploy](./production-deploy.md).

`deploy-dev` and `preview` guard every step on its secret, and the run summary
says which are missing rather than failing the build — a red cross on `main` for
infrastructure nobody has set up teaches people to ignore red crosses.
**`deploy-prod` does the opposite**: a missing production secret fails `apply`,
and no step in it has an `if`, because a production deploy that deploys nothing
and goes green is the one green tick that most needs to be true.

`check:workflows` holds all of this in place: `plan` exists outside any
environment and runs both scripts unconditionally, every `production` job
`needs` it, no production step is conditional, `deploy` in `deploy-dev` needs
the waiting job, and `check.yml` does not cancel runs on `main`.

## Deploy credentials: two sets, and only an approved job gets production's

| Secret | Scope | Read by | Reaches production? |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | repository | `deploy-dev` | no — scoped to `circles-dev` |
| `SUPABASE_DEV_PROJECT_REF` | repository | `deploy-dev` | no |
| `EXPO_TOKEN` | repository | `deploy-dev`, `preview` | must not — see the Expo caveat below |
| `SUPABASE_PROD_ACCESS_TOKEN` | `production` environment | `deploy-prod` | yes — scoped to `circles-prod` |
| `SUPABASE_PROD_PROJECT_REF` | `production` environment | `deploy-prod` | — (a ref, not a credential) |
| `EXPO_PROD_TOKEN` | `production` environment | `deploy-prod` | yes |

**Why the environment, and not the repository.** A repository secret is handed
to every workflow run on a same-repo branch, including `preview`, which runs the
PR's own workflow file and executes every dependency through `expo export`. One
compromised npm package, or one branch from anything with push access, could
then deploy production or run SQL on it with no approval. An environment secret
is handed only to a job that names the environment, and only after its
protection rules pass — here, the required reviewer and the `main`-only branch
policy. The approval used to gate the *job* while the credentials sat at
repository scope, so it gated nothing (SUS-104).

**Why different names.** When a job names an environment and the environment
lacks a secret, GitHub falls back to the repository secret of the same name. A
production token stored as `SUPABASE_ACCESS_TOKEN` and later deleted would
silently become a production deploy with the dev token. With distinct names the
fallback finds nothing and `deploy-prod` fails, saying which is missing.
`check:workflows` keeps it that way: it fails if a production name is read
outside a `production` job, or a `production` job reads a dev name.

**With one reviewer, the approval is a pause, not a review.** `sushen25` is the
only required reviewer and "prevent self-review" is off, because turning it on
with one person would make production undeployable. It still stops a deploy
nobody meant to start, and it is what keeps the production credentials away
from every other job. Turn "prevent self-review" on the day a second reviewer
exists.

**Supabase tokens are scoped to one project.** Account → Access Tokens →
Generate token offers *Resource access: Project*, a project list and per-area
permissions. Each deploy token names exactly one project, so the dev token
cannot reach `circles-prod` at all. Grant what the workflow runs and nothing
else — this set was proven on `github-actions-prod`, 9 October 2026, by the
read-only check in "Rotating them":

| Permission | Level | Needed by |
|---|---|---|
| Project | read | `supabase link` |
| API gateway keys (`api_gateway_keys_read`) | read | `supabase link`, which reads the project's keys; without it, link fails with `Missing required permission(s): api_gateway_keys_read` |
| Database | write | `db push`, which creates a temporary login role through the Management API |
| Edge Functions | write | `functions deploy` |

The older "legacy" token on that form reaches the whole account; CI never uses
one.

**Supabase tokens expire.** A CI token that lapses fails the next deploy with an
authentication error that looks like a misconfiguration. Mint the replacement
a week before the date, prove it with the read-only check, and store it with
the same `gh secret set` — the workflow does not change. Write the date here
when you mint one:

| Token | Project | Expires |
|---|---|---|
| `github-actions-prod` | `circles-prod` | 7 January 2027 (90 days from 9 October 2026) |
| `github-actions-dev` | `circles-dev` | _fill in_ |

**What still reaches production, and was accepted.**

- **Expo.** A token that can deploy a project's preview aliases can also run
  `eas deploy --prod` on it: EAS has no per-alias permission. Separate tokens
  still mean a leaked preview token can be revoked without touching production,
  and its use shows up as a different actor.

### Rotating them

Founder work in three consoles; nothing here can be done from the repository.

1. **Supabase** → Account → Access Tokens → Generate token, twice, with
   *Resource access: Project* and the permissions above: `github-actions-prod`
   on `circles-prod` only, and `github-actions-dev` on `circles-dev` only.
   Before storing the production one, prove it reaches what the workflow
   needs, read-only, **in a scratch copy of `supabase/`** — `link` writes the
   project ref into `supabase/.temp`, and a checkout linked to production makes
   every later `--linked` command aim at it:

   ```bash
   d=$(mktemp -d) && cp -R supabase "$d/" && cd "$d"
   read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
   ~/Repos/circles/node_modules/.bin/supabase link --project-ref bhunoaqswteamabbyckp
   ~/Repos/circles/node_modules/.bin/supabase db push --linked --dry-run
   ~/Repos/circles/node_modules/.bin/supabase functions list --project-ref bhunoaqswteamabbyckp
   ```
2. **Expo** (`sushen25s-team`, the account that owns the project — see
   `environments.md`) → Robot users: create one robot for production deploys
   and one for dev and previews, each with the role today's CI robot has, and a
   token for each.
3. **GitHub** → Settings → Environments → `production` → Environment secrets:
   `SUPABASE_PROD_ACCESS_TOKEN`, `SUPABASE_PROD_PROJECT_REF`, `EXPO_PROD_TOKEN`.
4. **GitHub** → Settings → Secrets and variables → Actions → Repository secrets:
   replace `SUPABASE_ACCESS_TOKEN` and `EXPO_TOKEN` with the dev tokens, and
   delete `SUPABASE_PROD_PROJECT_REF`. Store each token with
   `gh secret set NAME [--env production]`, which prompts without echoing, so
   the value is never in shell history.
5. Check: `gh api repos/sushen25/circles/environments/production/secrets`
   lists the three production names, and `gh api
   repos/sushen25/circles/actions/secrets` lists only
   `EXPO_TOKEN`, `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DEV_PROJECT_REF`.
6. Prove it: a PR's `preview` and the next `deploy-dev` go green, and a
   `deploy-prod` dispatch stops at the approval prompt, then authenticates
   (`eas whoami` names the production robot).
7. **Revoke the old tokens** — the Supabase and Expo ones named `github-actions`
   from September, and any other account-wide (legacy) Supabase token,
   including the one kept for local log queries in
   `~/.config/circles/supabase-token`. Replace that one with a token scoped to
   `circles-dev`.

## The repository is public

Decided by the founder on 2 October 2026. Three things follow:

- **Everything committed is world-readable**: runbooks, ADRs, project refs,
  workflow files, and every branch name. A Linear ticket's title becomes its
  branch name, so a ticket about an unfixed weakness should have a neutral
  title. Audit reports stay in `docs/audits/`, which is git-excluded.
- **Fork PRs get no secrets** and need an approval before their workflows run.
  The exposure is same-repo branches and the dependency tree, which is what the
  credential split above is for.
- **Branch protection is on**: `main` requires the `check` status.

## Branch protection

What the repository does, and what only the founder can change. Checked with
`gh api repos/sushen25/circles/branches/main/protection` on 9 October 2026.

| Setting | Now | Why it matters | Decision |
|---|---|---|---|
| Required status `check` | on | A PR cannot merge red | done |
| `enforce_admins` | **off** | The owner can merge past a red check, or push to `main` with no PR. That is how `ff3a132` (29 September) and PR #123 (3 October) reached `main` | Waiting on the founder (SUS-105 asks). Until then: **do not merge past a red check.** The workflows now backstop it: a red or unfinished `main` commit is not deployed to dev (`wait-for-check`) and `deploy-prod` refuses it |
| "Require branches to be up to date" (`strict`) | **off** | A PR need not include `main` before it merges, so two PRs that are green separately first meet on `main` (`4611bcb`, 2 October) | Waiting on the founder, and on SUS-179: with it on, every stacked PR pays the gate twice (27 minutes before SUS-179, about 9 after). Merge queue is the alternative. Until then: rebase before merging, as the ticket skills say |

`check.yml` no longer cancels a run on `main` (SUS-105): each `main` commit gets
its own concurrency group, because a group holds one pending run and a third
push would cancel it. A cancelled `main` check was a commit that dev and
production had no verdict for.

## What it costs, and the lever if it matters

**Actions minutes are free on a public repository**, so nothing below costs
money today. It is kept because it would again if the repository went private:
then the Free plan meters **2,000 minutes a month**, Linux at 1×, **each job
rounded up to the whole minute**.

Measured on 7 September 2026, before any deploy step was doing real work:

| Run | Wall clock | Billed |
|---|---|---|
| `check`, green | 5.2–5.8 min | 6 min |
| `check`, failing partway | 3.1–3.2 min | 4 min |
| `preview`, no `EXPO_TOKEN` | 8 sec | 1 min |

About **7 billable minutes per push**, so roughly 285 pushes a month. A whole
day of heavy work — twelve runs, five of them red — came to 36 minutes.

**This has now grown, as predicted.** `preview` really exports and deploys, at
about 1m45s, and `deploy-dev` runs on every merge. A code PR costs roughly
`check` (6 min) + `preview` (2 min), and a merge adds `deploy-dev` on top.

Two things pull the other way. Prose-only changes take the fast lane — `check`
in about a minute, no `preview`, no `deploy-dev` (SUS-72) — and Slice 0 produced
a great deal of prose. Overage is $0.008/min, so even a thousand minutes over is
a few dollars.

### The lever

If previews become the expensive half, run them only when asked for, rather than
on every pull request:

```yaml
# .github/workflows/preview.yml
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]

jobs:
  preview:
    if: contains(github.event.pull_request.labels.*.name, 'preview')
```

**Now worth measuring rather than assuming.** The original reasoning — that
`preview` cost one rounded-up minute, so gating it would save nothing — no
longer holds: it exports and deploys for real, at about 1m45s a PR. A preview
you have to remember to ask for is still a preview nobody looks at, so this is a
trade rather than an obvious win.

Tracked as **SUS-70**, and no longer blocked: S0-11 is done, so there is
something to measure. Take a month of real numbers against the table above
before pulling it.

The larger lever — making the repository public, which makes Actions free and
branch protection available — was pulled on 2 October 2026.

## Build, update, deploy — three different things

Expo uses three words that all sound like "ship it", and choosing the wrong one
is how a fix appears to go out and reaches nobody.

| | What it produces | Reaches | When you need it |
|---|---|---|---|
| **build** (`eas build`) | a native binary — `.ipa` / `.apk` | nobody until it is installed | native code or config changed: a new `expo-*` module, a config plugin, an SDK upgrade, a bundle id |
| **update** (`eas update`) | a JavaScript and asset bundle | every installed binary listening on that **channel**, at next launch | JS-only changes — screens, copy, logic |
| **deploy** (`eas deploy`) | the exported **web** build | anyone with the URL, immediately | any web change at all |

A merge to `main` does two of the three: `deploy` for web, `update` for native.
It never builds, because a merge that needs a build is a merge that changed
native code, and that is a deliberate act.

### The channel has to match

An update goes to a **channel**; a build subscribes to one, set by its profile
in `eas.json`. Ours are `development`, `preview` and `production`.

Architecture §5.1 calls the hosted environment `dev`, and the first version of
`deploy-dev.yml` accordingly published `--channel dev` — **a channel no build
subscribes to**. The update would have succeeded and reached zero devices. The
workflow uses `development` now: the channel a binary listens on is the
authority, not the environment's nickname.

### What stops an incompatible update

`app.config.ts` sets `runtimeVersion: { policy: 'appVersion' }`. An update is
only delivered to a binary with the same runtime version, so changing native
code and bumping the version means old clients simply do not receive it — they
wait for a build. That is the guard against shipping JS that calls into native
code the installed app does not have.

## EAS workflows

`.eas/workflows/build-development.yml` builds iOS and Android development
clients; `update-dev.yml` publishes to the `dev` channel. Both are
`workflow_dispatch` — native delivery starts in Slice 3, and until then a
development client is only wanted when someone asks for one.

## What runs, and when it does not

A prose change cannot break the suites, so it does not pay for them. "Prose"
means **Markdown anywhere and `.claude/`, and nothing else** — `docs/design/`
is excluded on purpose, because `gen.py` is the source the design tokens are
generated from and `check:tokens` reads it.

| Workflow | On a prose-only change |
|---|---|
| `check` | Runs. gitleaks and `format:check` execute; the suites, Playwright and Supabase do not. |
| `preview` | Does not run. |
| `deploy-dev` | Does not run (no wait to pass either). |

The two mechanisms differ on purpose:

- `preview` and `deploy-dev` use `paths-ignore`, so the run never starts. They
  produce artefacts, and a Markdown change cannot alter a bundle or a database.
- `check` keeps running and skips steps instead, for two reasons.
  **gitleaks must not be skipped** — a Markdown file is exactly where someone
  pastes a token, and `paths-ignore` would turn off secret scanning on the
  highest-risk file type. And a skipped job reports no conclusion, which leaves
  a required status check pending forever once branch protection is on.

`format:check` still runs on prose because root Markdown *is* formatted:
`.prettierignore` excludes `docs/` and `.claude/`, but not `AGENTS.md`,
`README.md` or `CLAUDE.md`. Prose skips the suites, not the gate.

`scripts/ci-scope.mjs` makes the call and defaults to `code` whenever it cannot
tell — an empty diff, a merge commit, an unrecognised path. Being wrong that way
costs a slow run; being wrong the other way costs a broken `main`.

## One Supabase CLI, and it is the workspace's

CI does not use `supabase/setup-cli`. Every workflow runs `pnpm exec supabase`,
so the CLI is the pinned devDependency and `pnpm install --frozen-lockfile`
already put it there.

There used to be two. The action installed `latest` for `supabase start`, while
`pnpm check`'s own `db:test` and `check:types` resolved the devDependency
through `node_modules/.bin` — so a single job could run two versions, and the
gate could test against a CLI nobody has locally. That is the failure mode
`pnpm check` exists to prevent.

It also removed a dependency on the GitHub API: resolving `latest` rate-limited
and failed a run on 9 September 2026, on a change that had nothing to do with
Supabase.

The version lives in one place, `package.json`, pinned exactly rather than to a
range so a fresh resolve cannot move it. Upgrading is `pnpm add -D supabase@<v>`
and nothing else.

## A job installs before it uses pnpm, and `check:workflows` proves it

`deploy-prod` ran `pnpm run build` and `pnpm exec supabase` **before**
`pnpm install`. It would have failed on its first production deploy — the one
run where a late failure costs most — and nothing would have caught it, because
that workflow has never executed.

`scripts/check-workflows.mjs` reads every job in `.github/workflows` and
`.eas/workflows` and fails when a step uses `pnpm exec`, `pnpm run` or
`pnpm --filter` before the job's `pnpm install`, or with no install at all. It
is in `pnpm check`.

It also keeps the two sets of deploy credentials apart: a production secret
name (`SUPABASE_PROD_ACCESS_TOKEN`, `SUPABASE_PROD_PROJECT_REF`,
`EXPO_PROD_TOKEN`) read by a job outside the `production` environment fails it,
and so does a `production` job reading `SUPABASE_ACCESS_TOKEN` or `EXPO_TOKEN`
(see "Deploy credentials" above).

This is the cheapest available answer to a problem that has now bitten twice: CI
cannot exercise the deploy paths on a pull request, so the next best thing is a
check that reads them.

## Never interpolate the event payload into a `run:` block

`${{ ... }}` is substituted into the script **before the shell sees it**, so any
attacker-controllable value becomes script text. `deploy-dev` passed a commit
message that way:

```yaml
run: eas update --message "${{ github.event.head_commit.message }}" ...
```

A commit titled `oops"; echo PWNED; #` executes on a runner holding `EXPO_TOKEN`
and `SUPABASE_ACCESS_TOKEN`. Verified by reproducing it, not by reasoning about
it.

Pass such values through `env:` instead. The shell then receives them as data,
and quoting is the shell's problem rather than the templating engine's:

```yaml
env:
  COMMIT_MESSAGE: ${{ github.event.head_commit.message }}
run: |
  message=$(printf '%s' "${COMMIT_MESSAGE:-fallback}" | head -1 | cut -c1-200)
```

Two values are still interpolated directly, and both are safe:
`github.event.pull_request.number` is an integer, and
`github.event.pull_request.head.sha` goes into a comment body as an action
input, never into a script.

The same step was also broken on `workflow_dispatch`: `head_commit` exists only
on `push`, so a manual run sent an empty message and `eas update` refused it.
Any value read from the event payload has to have a defined meaning under
**every** trigger the workflow declares.

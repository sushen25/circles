# CI

Three GitHub workflows and two EAS ones. `check` is the only one that gates a
merge; the rest deploy.

## `check` — the gate

Runs on every pull request and on `main`. It runs **exactly `pnpm check`**,
because a CI that checks something different from the local command is one
people learn to ignore (architecture §16).

| Step | Why |
|---|---|
| gitleaks | First, before the build. Finishing a build before reporting a leaked secret helps nobody. |
| `pnpm install --frozen-lockfile` | Catches a lockfile that was never updated — it has already caught one. |
| Playwright browsers | Cached on the lockfile hash. |
| `supabase start` | Database only. `pnpm check` resets it and runs pgTAP, and `check:types` generates types from the live schema. |
| `pnpm check` | The gate. |

A failing run uploads the Playwright report as an artefact.

**It blocks what it should.** Verified on a throwaway PR: a `react` import in
`packages/domain` fails with `domain is not allowed to import "react"
(architecture §7.2)`, and editing `gen.py` without regenerating fails with
`check:tokens: generated.ts is stale`.

**Two workflows run per push.** When reading a result, name the one you mean —
`preview` passes trivially while there is no `EXPO_TOKEN`, and mistaking it for
`check` gives a green tick that means nothing.

## `deploy-dev`, `deploy-prod`, `preview`

**`deploy-dev` and `preview` work.** Every secret they need is set, a merge to
`main` deploys, and a PR gets a preview URL. `deploy-prod` has never run: it is
`workflow_dispatch` only, the `production` environment does not exist yet, and
its secrets are absent (SUS-71).

Every step is still guarded on its secret, and the run summary says which are
missing rather than failing the build — a red cross on `main` for infrastructure
nobody has set up teaches people to ignore red crosses.

**Treat `deploy-prod`'s first real run as untested.** Turning `deploy-dev` on
found six defects in a path that had only ever skipped: no workspace build
before the export, no `eas-cli` installed at all, no `pipefail` (which is why
the second looked green), the build placed after the Supabase steps rather than
before, `date-fns-tz` missing from the Edge Function import map, and a
`workflow_dispatch` run sending an empty `eas update --message`. Two of those
shapes are now caught locally by `check:client-env` and `check:imports`; the
rest are working-process rule 2.13.

| Secret | Used by | Comes from |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | dev, prod | Supabase account tokens |
| `SUPABASE_DEV_PROJECT_REF` | dev | the `circles-dev` project |
| `SUPABASE_PROD_PROJECT_REF` | prod | the `circles-prod` project |
| `EXPO_TOKEN` | dev, prod, preview | Expo account tokens |

`deploy-prod` is `workflow_dispatch` only and runs in the `production`
environment: **configure that environment with a required reviewer**, which is
the actual approval gate (§18). It also prints `supabase db push --dry-run`
before applying anything.

## Still to do by hand

**Required status checks on `main` are not set.** The repository is private on a
free plan, and branch protection needs GitHub Pro or a public repository:

```
Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)
```

Until one of those, `check` runs on every PR but nothing stops a merge while it
is red. Two ways out, both the founder's call: upgrade, or make the repository
public. Neither is something to decide on someone's behalf.

## What it costs, and the lever if it matters

The repository is private, so Actions minutes are metered: **2,000 a month** on
the Free plan, Linux at 1×, **each job rounded up to the whole minute**.

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

There is a larger lever behind it: **Actions is free and unlimited on public
repositories**, and branch protection is free there too, which would also
resolve the required-status-check gap above. That is a decision about publishing
the specs and the design canvas, not about cost — at 36 minutes for a heavy day,
cost is not the pressure.

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
| `deploy-dev` | Does not run. |

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

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

None of these can do anything yet. Every step is guarded on its secret, and the
run summary says which are missing rather than failing the build — a red cross
on `main` for infrastructure nobody has set up teaches people to ignore red
crosses. **S0-11 creates the projects and adds the secrets**, after which they
start working with no change here.

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

**This grows once S0-11 lands.** `preview` exits in eight seconds today only
because there is no token; once it exports and deploys it is nearer 3–4 minutes,
and `deploy-dev` starts running on every merge. Expect **12–15 minutes per PR
cycle**, so around 140 cycles a month. Overage is $0.008/min, so even a thousand
minutes over is a few dollars.

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

**Do not pull this yet.** Right now it would save nothing — `preview` costs one
rounded-up minute — and a preview you have to remember to ask for is a preview
nobody looks at. Revisit when there is a month of real numbers with S0-11's
secrets in place, and compare against the table above.

Tracked as **SUS-70**, blocked by S0-11 so it cannot be picked up before there
is anything to measure.

There is a larger lever behind it: **Actions is free and unlimited on public
repositories**, and branch protection is free there too, which would also
resolve the required-status-check gap above. That is a decision about publishing
the specs and the design canvas, not about cost — at 36 minutes for a heavy day,
cost is not the pressure.

## EAS workflows

`.eas/workflows/build-development.yml` builds iOS and Android development
clients; `update-dev.yml` publishes to the `dev` channel. Both are
`workflow_dispatch` — native delivery starts in Slice 3, and until then a
development client is only wanted when someone asks for one.

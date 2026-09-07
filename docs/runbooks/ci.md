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

## EAS workflows

`.eas/workflows/build-development.yml` builds iOS and Android development
clients; `update-dev.yml` publishes to the `dev` channel. Both are
`workflow_dispatch` — native delivery starts in Slice 3, and until then a
development client is only wanted when someone asks for one.

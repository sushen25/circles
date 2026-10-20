# Handover, 20 October 2026: the content move, and what to build next

For the coding agent picking up the Circles repo. Read `AGENTS.md` first, as
always; this note says where things stand today, what is in flight, and the
order the next tickets should land in. Everything here was decided with the
founder on 19 and 20 October.

## 1. Where things stand

- `main` is at `4e913868` (merge of PR #243). 165 tickets Done, ~23 In Review,
  31 Backlog in the Circles MVP project.
- Slices 0 to 2 are live on wenna.app. Slice 3 (native) and Apple/Google sign-in
  are held until a group names something the browser could not do.
- No stranger has used the product yet. The friends-cohort reading that gate
  G-A needs (`claude/lean-hypotheses-and-gates.md` §5) has not been written and
  SUS-48 is still Backlog. The founder dashboard (SUS-166) can produce it.
- Three documents frame the product decisions, all in the Wenna project in
  Claude: the direction doc *Wenna: Product Direction from First Principles*,
  *Wenna: First Principles of Belonging* (the ten principles), and *Wenna: What
  to Build Next* (19 Oct; summarised in `claude/what-to-build-next-oct-2026.md`).
  The founder has a saved skill, `wenna-first-principles-check`, that scores a
  feature against the ten principles and the manifesto's guardrails and returns
  Build / Test first / Reshape / Hold. Every ticket below went through it.

## 2. In flight: the content loop moved into this repo

Branch `sushensatturu25/content-moves-into-the-monorepo`, one commit
(`3495db2f`), **committed locally and not yet pushed** (the session that made
it had no GitHub credentials). The founder pushes and opens the PR; the body is
in the session notes. What the commit does:

- `content/` is a fresh copy of `sushen25/wenna-content` (source, context,
  queue, skills, docs); no renders, no history, no `.env`. The old repo keeps
  the history and is to be archived.
- `content/` is its own npm project outside the pnpm workspace. ADR 0081 records
  it. `scripts/ci-scope.mjs` treats `content/` as prose; `.prettierignore`,
  `eslint.config.mjs` ignore it; `deploy-dev.yml` and `preview.yml` have
  `paths-ignore: content/**`. gitleaks and `check:workflows` still cover it.
- Two root workflows, `content-publish.yml` and `content-analytics.yml`, run
  with `working-directory: content` and commit only under `content/`.
- `content/lib/links.ts`: every published link becomes
  `wenna.app/?from=<platform>-<slug>` (prefixes `tt ig th bs li yt rd`; slug
  rule `^[a-z0-9-]{1,40}$`). Drafts write `wenna.app` plain; `npm run check`
  in `content/` fails a hand-typed `?from=`. Standing hand tags (`tt-bio`,
  `ig-bio`, `rd-profile`, `cmp-*`) are listed in `content/context/facts.md`.

Verified before committing: `ci-scope` classifies `content/**` as prose;
`node scripts/check-workflows.mjs` passes; `node scripts/check-docs.mjs` passes
with ADR 0081 and the regenerated `docs/decisions/index.md`
(`pnpm gen:adrs`); `npm ci && npm run dry-run` work from `content/`. Not run:
`pnpm check` (no Docker in that shell). The change is prose-scoped, so CI runs
Prettier, `check:docs` and the unimported-file check.

After the PR merges, founder-only steps: add the platform secrets (`BSKY_*`,
`THREADS_*`, `IG_*`, `LINKEDIN_*`) and the `MEDIA_BASE_URL` variable (a bucket
that serves `content/out/<slug>/`) to this repo's settings; archive
`wenna-content`; re-point the Claude Code Routine that runs `/daily` at this
repo, working in `content/`.

## 3. Tickets raised on 19 and 20 October

| Ticket | What | Verdict from the check | Blocked by |
| --- | --- | --- | --- |
| SUS-237 | The circle's record: past catch-ups on circle home; Plan another and the about-time nudge speak from the last one ("Same as the Hope St dinner in September?") | Reshape of a "timeline" idea → Build | SUS-117 (retention for notes and place names) |
| SUS-238 | "That was a good one": one optional tap after "I was there", surfaced as a fixed three-state sentence (people / someone / nothing) to whoever plans the next one; never a count, never a letter | Reshape → Build, read as a test | none (pairs with SUS-237, has a fallback without it) |
| SUS-240 | A stranger's path from a post to a first plan is observable: `?from=` tag on the circle's founder-only cohort row, a "stalled first plans" founder view, a one-tap "what happened?" on the empty waiting screen at 48 h, a once-per-circle "want a hand?" letter from the founder | Instrumentation; no scorecard | none |

Not yet ticketed, and first in the build order below: **the "Again?" card**.
When the organiser reports *happened*, one card, "Same again in {cadence}?",
whose primary opens Plan another pre-filled (what, duration, quorum, usual time
of day, window from the cadence) and whose quiet action is "Not now". Once per
happened meetup, under the §5.11 caps, never on a guest's screen,
`plan_another_started(moment: morning_after)`; a line in spec §5.10; one ADR.
Full shape in *What to Build Next*, Recommendation step 3. Raise it as a ticket
in the usual Context / Read first / Implementation / Acceptance / Tests / Out
of scope shape before starting it.

## 4. The order

The founder's own rule (8 Oct plan, confirmed 20 Oct): make the product safe
for strangers, ship the smallest retention build, then recruit ten groups and
read the funnel before building anything larger.

1. Land the content-move PR (section 2).
2. **Safety before strangers:** SUS-167 (Supabase Pro, backups, PITR), SUS-66
   (privacy pages, terms, deletion), merge SUS-170 (feedback link, In Review).
3. **The "Again?" card** (raise, then build). Small; it is the one retention
   build the direction doc and the report agree on.
4. **SUS-240 parts 1 and 2** (the tag on the cohort row; the stalled-plans
   view). Founder-only, about a day, and they make the content channel readable
   from the first tagged post. Parts 3 and 4 can follow.
5. **SUS-237**, moves 2 and 3 first (copy only, land in a day), then move 1
   once SUS-117 is decided.
6. **SUS-238**, smallest slice first: the tap behind a flag, logged only.
7. Everything else waits for the private cohort's week-6 gate (G-C): soft
   availability, quiet-ask surfacing, dormant-circle revival, native, open
   seats.

Use `work-tickets-in-parallel` for 2 to 4; they do not collide. SUS-237 and
SUS-238 touch the same screens (circle home, Plan another, the about-time
letter) and should be serial, 237 first.

## 5. Things learned this week that will bite

- **gitleaks scans branch history**, not the working tree. Never commit a
  secret and remove it; keep it out of the history (AGENTS.md).
- **`check:workflows` pins actions by commit SHA** with a trailing version
  comment; copy the pinned lines from `check.yml`.
- **The ADR index is generated**: after adding an ADR run `pnpm gen:adrs` and
  commit `docs/decisions/index.md`, or `check:docs` fails.
- **`ci-scope` PROSE is `[/\.md$/i, /^content\//]`** on `main` now; `.claude/`
  is code because its `.sh` files run with credentials.
- **Reminder and letter tests are quiet-hours sensitive** (21:00–08:00
  Melbourne): pin the clock (SUS-91/95/216 pattern).
- **`check:brand`** fails any literal product name or domain under `apps/`,
  `packages/`, `supabase/`, `scripts/`; read it from `brand` in
  `packages/config`. `content/` is exempt by design.
- **The sandbox shell on the founder's machine** has no `pnpm`, no Playwright
  browser and no GitHub credentials; run `pnpm check` and `git push` from a
  real terminal.
- **SUS-117 gates SUS-237**: if the record is built before retention for notes
  and place names is decided, it will silently forget its oldest rows.

## 6. Where the thinking is

- Repo: `docs/mvp-product-spec.md` (§5.9 cadence, §5.10 outcome, §5.11
  prompts and caps), `docs/decisions/` (0036, 0061, 0067, 0069 matter most for
  the tickets above), `docs/research/pricing-research.md`,
  `docs/research/meetup-market-research.md`.
- Wenna project in Claude: `claude/circles-context.md`,
  `claude/lean-hypotheses-and-gates.md`,
  `claude/post-mvp-reach-and-feedback-plan.md`,
  `claude/what-to-build-next-oct-2026.md`,
  `claude/first-principles-of-belonging.md`,
  `claude/reddit-listen-answer-pass-1.md`.
- Market and user evidence (Oct 2026), in *What to Build Next*: nobody in the
  category does a post-event loop or recurrence for friend groups (GroupMe and
  Discord excepted); the loudest user pain is sole-initiator fatigue, not
  finding a time; the folk fixes (fixed slot, over-invite, rotating host,
  low-stakes open invites) map onto cadence, quorum, take-turns and soft
  availability.

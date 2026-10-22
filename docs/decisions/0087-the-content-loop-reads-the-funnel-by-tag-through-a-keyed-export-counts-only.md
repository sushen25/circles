---
adr: 87
title: "The content loop reads the funnel by tag through a keyed export, counts only"
status: proposed
date: 2026-10-22
builds_on: [15, 58, 81, 84]
---
# ADR 0087: The content loop reads the funnel by tag through a keyed export, counts only

_Status: proposed · 22 October 2026 · builds on [ADR 0084](0084-a-campaign-tag-labels-a-circles-cohort-row-never-a-person.md), whose by-tag funnel it lets one script read, on [ADR 0058](0058-every-circle-carries-a-cohort-only-the-founder-can-see.md), whose founder-only door it keeps shut to everything else, on [ADR 0081](0081-the-content-loop-lives-in-the-monorepo-outside-the-gate.md), the loop it serves, and on [ADR 0015](0015-sql-functions-live-in-one-file-each.md), for where the new function lives_

## Context

The content loop (`content/`, ADR 0081) publishes posts whose links carry a tag
(`?from=ig-never-lead-anywhere`), and Wenna writes the first tag of a visit onto
the circle's cohort row (ADR 0084). The founder screen reads circles made,
plans shared, answered and confirmed by tag, and the first plans that stalled.
That is the number that decides whether content is a channel at all:
`content/experiments.md` has a "Plans shared" column for it and leaves it
blank, because nothing outside the founder screen can read it.

The loop runs as a nightly GitHub Action that already pulls every platform's
numbers into `content/analytics/` and builds a scorecard from them
(`content/docs/analytics-plan.md`). It cannot read the funnel:
`public.founder_analytics` is gated on `auth.uid()` being on the founder
allowlist, so a script would need a founder's session, and a founder's session
in CI is a rotating refresh token, a person's credential, in a bot.

## Decision

**One function computes the by-tag numbers, and two doors call it.**
`public.source_ref_export(p_since date) returns jsonb` holds the
`by_source_ref` and the `stalled` blocks that `founder_analytics` returns
today (the latter read from `analytics.stalled_first_plans`), factored out so
both read one definition (ADR 0015: one file under
`supabase/sql/functions/public/`, generated into the migration).
`founder_analytics` calls it after its allowlist check and its own answer does
not change. The new function is in `public` because the Edge Function's
service client calls it through PostgREST, which exposes that schema and no
other; the grants are what keep it shut: `security definer` with
`set search_path = ''`, executable by `service_role` only, revoked from
`public`, `anon` and `authenticated`. The period clamps to 400 days, as the founder function does.
Its answer has the shape of `SourceRefNumbers` and `StalledRow` in
`packages/contracts`, with the stalled rows filtered to the `content` source.

**It answers counts and ages, and names nothing.** Per tag: circles made, plans
shared, answered, confirmed. Per stalled first plan: the week the circle began,
the state, the hours since, and the tag. No circle, plan, member, short code,
uuid or name, as for the founder screen (ADR 0084). A tag is a label on a post,
never on a person, so a count by tag is a fact about a post.

**`content-funnel` is an internal Edge Function with a secret of its own.** It
is built on `internalHandler`, which gains one parameter: the name of the
secret it checks. `recalculate-candidates` and `process-scheduled-jobs` keep
`CRON_SECRET`; `content-funnel` reads `CONTENT_FUNNEL_SECRET`, so the content
loop's secret can never run the job processor, and the job processor's can
never read the funnel. POST only, body `{ since }` (a date), a 405 on any
other method. Every call is refused while the secret is unset (off until
configured). A rate limit from `take_rate_token` of six calls an hour, keyed to
the function, since there is no caller. One log line, the status, and nothing
from the answer. `verify_jwt = false` in `config.toml`, as for the other
internal functions, and architecture §9.1 lists it as internal.

**The counts land in the public repository.** The loop writes the export's
answer, as returned, to `content/analytics/funnel.jsonl`, one row per tag per
night, and the scorecard and the retro read it from there. The repository is
public. Platform numbers already are; counts of circles and plans by tag are
not, until this lands. `experiments.md` intended them in the repository from
the start, and a count by post tells a reader how a post did, never who came.

## Alternatives considered

- **A founder's session in CI.** A rotating refresh token in GitHub, and a
  person's credential acting as a bot. The allowlist would also stop meaning
  "a person looked".
- **The service-role key in GitHub.** Every table, for one read. A leak would be
  the whole database.
- **A `pg_cron` dump to a private bucket.** A second credential, a bucket, and a
  stored copy of what a function computes fresh. It would also keep the counts
  out of the repository, which is the one thing it would buy (below).
- **Keeping the counts out of the public repository.** A git-excluded
  `analytics/private/` cannot be persisted by the nightly bot, so it needs a
  private bucket and a second secret for it, and the scorecard and the retro
  then read from two places. Worth it only if counts by tag are judged
  sensitive; this record judges them not to be, for the reason above.
- **A weekly export by hand.** The step that is skipped in week three.
- **Reusing `CRON_SECRET`.** One secret fewer, and the content loop's GitHub
  secret could then drive the job processor.

## Consequences

- A migration (the factored function, `founder_analytics` calling it, the
  grants) with pgTAP: `service_role` may call it, `anon` and `authenticated`
  may not, and the answer holds no uuid, no short code and no name, the same
  assertions `380_founder_analytics.sql` makes; and a check that the founder
  function's answer is unchanged.
- `internalHandler` takes the secret's name; the two existing internal
  functions pass `CRON_SECRET` and nothing else about them changes. A handler
  test for the bearer check, the unset secret and the 405.
- A contract test that the answer parses as `SourceRefNumbers` and
  `StalledRow`.
- `CONTENT_FUNNEL_SECRET` is set as an Edge Function secret in production and
  as a GitHub secret beside the deploy credentials the repository already
  holds. Deleting either turns the door off; nothing else depends on it.
- `docs/runbooks/campaign-links.md` gains "Read it from the content loop",
  `docs/technical-architecture.md` §9.1 lists the function, and the spec is
  untouched, because no product rule changes.
- On the content side, `content/analytics/platforms/wenna.ts` posts with the
  secret to `WENNA_FUNNEL_URL` and writes `funnel.jsonl`; the scorecard shows
  circles made and plans shared by tag as raw counts, never as rates, and
  `npm run retro` fills the two blank columns of `experiments.md`.

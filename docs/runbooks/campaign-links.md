# Campaign links

How to tag a link you post, and how to read what came of it. The reasoning is in
[ADR 0084](../decisions/0084-a-campaign-tag-labels-a-circles-cohort-row-never-a-person.md);
the screen is the founder analytics (`/founder/analytics`).

## Tag a link

Add `?from=<tag>` to the product's address:

```
https://<the product's domain>/?from=tt-always-the-one-3
```

The tag is one to forty of lowercase letters, digits and hyphens. Anything else
(capitals, spaces, an underscore, a dot, an address) is dropped and the link
works as an untagged one. The content loop makes its tags with `content/lib/links.ts`:
`<platform>-<slug>`, where the platform is `tt ig th bs li yt rd`. The standing
ones are `tt-bio`, `ig-bio` and `rd-profile`, and `cmp-<name>` for a comparison
page. Nothing in the product checks the prefix, so a new platform needs nothing
changed here.

Use a tag for a **post**, never for a person: it is a label on the circle, and
the circle's organiser never sees it.

## What happens to it

1. The marketing site hands it to "Start a plan" (`/start?via=site&from=<tag>`).
2. The app keeps the first tag of a visit on the device for 24 hours.
3. When the organiser passes the gate, the circle is made and the tag is written
   to that circle's founder-only cohort row (`private.circle_cohorts.source_ref`),
   once. The tag is then forgotten on the device.
4. "How did you hear?" is the last step of the first run, after the circle exists.
   An organiser who arrived on a tagged link is not asked it and is counted as
   `content`.

The tag is in no analytics event, log line or letter. Someone who opens the link
and never passes the gate leaves nothing.

## Read it

On `/founder/analytics`:

- **Funnel, chip "A post"** is the whole funnel for organisers who arrived on any
  tagged link.
- **By post** lists the tags seen in the period, the forty busiest, each with
  circles made, plans shared, people who answered and plans confirmed.
- **Stalled first plans** shows circles whose first plan has stopped, by the
  week the circle began and the source (`A post` for tagged ones): made and not
  shared after 24 hours; shared with nobody else answering after 48; answered
  but short of the quorum at the deadline. Counts and ages; the chips read one
  cohort at a time. "Shared" is the share sheet opening, and anybody who joined or
  answered shows it was shared, so the first state is a ceiling and the other two
  are floors.

To see which circles are behind a tag, as the database owner (local `make psql`;
on a hosted project, the SQL editor):

```sql
select cc.source_ref, c.name, c.created_at::date, cc.cohort
from private.circle_cohorts cc
join public.circles c on c.id = cc.circle_id
where cc.source_ref is not null
order by c.created_at desc;
```

Read them against the second-degree and in-person cohorts, not instead of them.
Arrivals are not counted: the site records nothing, so a post's reach is the
platform's number and everything from the gate on is ours.

## Read it from the content loop

The nightly content pull (`content/analytics/pull.ts`) reads the same by-tag
funnel without a founder's session, through a keyed export
([ADR 0087](../decisions/0087-the-content-loop-reads-the-funnel-by-tag-through-a-keyed-export-counts-only.md)).

**What it returns.** `POST <project>/functions/v1/content-funnel` with
`Authorization: Bearer $CONTENT_FUNNEL_SECRET` and body `{ "since": "YYYY-MM-DD" }`
answers `{ since, by_source_ref, stalled }`: per tag, the circle counters and the
totals of `plan_shared`, `availability_submitted` and `meetup_confirmed`
(the pull reads circles made, plans shared, answered and confirmed from these as the founder screen's "By post" does); and the
first plans from the `content` source that have stopped, by week, cohort, state,
count and age in hours. Counts and ages and nothing finer: no circle, plan,
member, short code, id, name or address. The function is
`public.content_funnel_export`, executable by `service_role` alone, and it shares
its numbers with the founder screen (`private.funnel_by_tag`). Any other method is
a 405; no bearer, a wrong bearer, `CRON_SECRET`, or no secret set at all is a 401
with the same body; a thirteenth call in an hour is a 429.

**What the pull writes.** One row per tag per night, and one row of stalled first
plans, appended to `content/analytics/funnel.jsonl`, which is in a public
repository: counts by post, never by person. Try it from a laptop with
`cd content && npm run analytics -- --only wenna --dry`.

**Switch it on (the founder's steps).** None of these is done by code.

1. Make the secret and set it on both hosted projects, a different value for
   each: `GENERATE=1 make secret ENV=dev K=CONTENT_FUNNEL_SECRET` for `dev`. For
   `prod`, make one value (`openssl rand -base64 32`), then pipe it in:
   `pbpaste | make secret ENV=prod K=CONTENT_FUNNEL_SECRET`.
2. Add the same `prod` value as a repository secret of the Circles repository:
   `gh secret set CONTENT_FUNNEL_SECRET` (paste at the prompt). It is a repository
   secret, not an environment one, because `content-analytics.yml` runs on a
   schedule outside any environment.
3. Add the address as a repository variable:
   `gh variable set WENNA_FUNNEL_URL --body https://<prod project ref>.supabase.co/functions/v1/content-funnel`.
4. After the next deploy to `prod`, run the workflow by hand (Actions,
   content-analytics, Run workflow) and look for `funnel <tag>: circles …` lines
   in the log, and a new `funnel.jsonl` in the commit.

Until 1 to 3 are done the pull says `skip  wenna: not configured` and carries on.

**Rotate it.** Make a new value; set it on the project (`make secret`) and as the
repository secret in the same sitting. The old value stops working the moment the
project has the new one, so the pull between the two steps is a 401 (a red
`FAIL  funnel` line, nothing written, the rest of the run unaffected). **Turn it
off:** delete the repository secret, or the project's: every call is refused while
it is unset.

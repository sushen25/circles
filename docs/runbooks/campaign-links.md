# Campaign links

How to tag a link you post, and how to read what came of it. The reasoning is in
[ADR 0083](../decisions/0083-a-campaign-tag-labels-a-circles-cohort-row-never-a-person.md);
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
4. An organiser who arrived on a tagged link is not asked "How did you hear?" and
   is counted as `content`.

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

---
adr: 83
title: "A campaign tag labels a circle's cohort row, never a person"
status: accepted
date: 2026-10-20
builds_on: [58, 61]
---
# ADR 0083: A campaign tag labels a circle's cohort row, never a person

_Status: accepted · 20 October 2026 · builds on [ADR 0058](0058-every-circle-carries-a-cohort-only-the-founder-can-see.md), whose founder-only row it adds a label to, and on [ADR 0061](0061-the-chasing-survey-never-holds-lock-it-in.md), whose "an optional question never gates anything" it applies to the source question_

## Context

Organic content reaches people we will never meet. The funnel counts the
stages they pass through, and "How did you hear about {brand}?" (SUS-171) says
which kind of place they came from, but not **which post**, and not **where a
first plan stopped**. Without both, content is a hope and not an experiment, and
a stranger who stalls at the first plan is lost data.

A post's link can carry a label (`?from=tt-always-the-one-3`). The label has to
reach the circle without becoming a fact about a person (non-negotiable 8): not
on the profile, not beside a name or an address, not in an event, a log line or
a letter.

## Decision

**The tag is a slug, and nothing else.** `^[a-z0-9-]{1,40}$`, held in one place
(`parseSourceRef` in `packages/domain`) and repeated in a check constraint. A
tag that is not a slug is dropped, not refused: a label must never be the reason
a circle is not made. The content loop's own prefixes (`tt-`, `rd-`, `cmp-`) are
that loop's business and are not in the rule.

**It rides the arrival and is written once.** The site, which has no script,
hands `?from=` on to `/start`; the app keeps it on the device for 24 hours (the
draft's life) beside the first-run draft, not inside it. When the organiser passes
the gate, `create-circle` forwards it and `tag_circle_source` writes it to that
circle's row in `private.circle_cohorts` as `source_ref`. Only the owner can
tag their circle, only once, and the function returns nothing. The first tag of
a visit wins.

**Founder-read only, by the same door as the cohort.** No client role has a
privilege on the table or the views, nothing in `public` has the column, and the
tag is in no analytics payload, log line or letter.

**A tag answers the source question.** An organiser who arrives on a tagged link
is not asked "How did you hear about {brand}?" The event is recorded as
`organiser_source(source: content)`, a new word, and the account's "asked" row
is written as for any answer, so skipping counts as asked and the question does
not come back.

**The funnel reads by tag, and the first plans that stopped are visible.** The
founder function gains the funnel counters and a few event totals by tag, and
a "stalled first plans" view, by the week the circle began, cohort, source and
state: made and not shared after 24 hours; shared with nobody else answering
after 48; answered, but short of the quorum at the deadline. It is computed from
product rows, as the gates are (ADR 0080): the plan, the circle's members and the
responses. The one fact with no row is whether the share sheet was opened, and
that is the `plan_shared` event. Anybody having joined or answered shows the
plan was shared whatever the event says, so a lost event can only make a plan read
as unshared for as long as nobody has come. The answer is counts and ages in
hours; it names no circle, plan or person.

## Alternatives considered

- **The tag on `circles` or the profile.** A column every member can read, or a
  fact joined to one person. The row of ADR 0058 is the one place with no path to
  a client.
- **The tag in the `circle_created` event.** Readable without a new view, and in
  the one place non-negotiable 8 and the catalogue say a payload must not carry
  anything that labels a person's origin. The event is also a client's claim.
- **Asking the source question anyway, with the tag as a hint.** Asks a stranger
  something we already know, and makes a skipped answer lose the tag's meaning.
- **A script on the site to carry the tag.** The site has no script on purpose
  (ADR 0052); the server writes the tag into the address of its own buttons.
- **A table of stalled plans, kept up to date.** New storage, and a copy of
  state the product tables already hold. A view reads it fresh.
- **Counting "shared" from the event alone.** A lost event would read a plan with
  three answers as unshared.

## Consequences

- A migration (the column, the function, three views) and a founder screen
  section for each of the two readings.
- `content` joins the five sources; an organiser who arrived on a tagged link and
  is later asked nothing is counted under it for every circle they own.
- A first tag outlives nothing: after the circle is made, or 24 hours, it is gone
  from the device, and a second organiser on the same browser starts clean.
- The tag is a free-form slug the founder chooses. The runbook lists the content
  loop's, and `cmp-*` for the standing campaign ones.
- Parts of SUS-240 that are not here (the question on the waiting screen, the
  founder's letter) are separate decisions and are not made by this record.

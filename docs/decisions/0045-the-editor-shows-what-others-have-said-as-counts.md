---
adr: 45
title: "The availability editor shows what others have said, as counts"
status: proposed
date: 2026-10-01
---
# ADR 0045: The availability editor shows what others have said, as counts

_Status: proposed · 1 October 2026_

## Context

Somebody answering a plan picks their times blind. They can usually do
several of the days on offer and have no way to tell which of them would
actually make the catch-up happen. On 1 October 2026 the founder reviewed an
interactive mockup and approved a direction (SUS-129): **the editor shows, as
counts, what the people who have already answered said**, so the guest can
favour the days and hours that meet the most people.

Until now nobody could see anybody else's availability before the
candidates screen: `plan_responses` and `willing_windows` are readable by
their owner alone (`0004_availability_scheduling.sql`), and the engine reads
them through a service-role function. Spec §5.5 said nothing about what an
answering member sees of other answers, because they saw nothing.

The ticket set three questions and recommended an answer to each. The founder
settled all three on 1 October 2026, choosing differently from the
recommendation each time. A fourth point came up while the ticket was being
built (see "What the function returns").

## Decision

The editor shows four kinds of count, and nothing else about anybody else:

1. **A line above the day grid**: "5 of 6 have answered. The number on each
   day is how many of them could make it." It is the legend for every other
   count on the screen. A reader who has answered already reads "4 of the
   other 5 have answered…".
2. **A figure on each day**: how many of the others could make that day. There
   is no figure on a day where the count is nobody.
3. **A third line on each time block** ("3 free", "Up to 5 free" when the
   ticked days differ, "Nobody yet") and **on each line of the answer**
   ("Overlaps with 5 others", "Overlaps with 1 other", "No overlap with anyone
   yet").
4. **Over an open day's half hours**: one sentence ("Others free, by the half
   hour. The most is 5, 6:30–8:30 pm.") and a figure over each cell, with the
   highest ones in full ink. A day nobody else picked reads "Nobody else has
   picked this day yet." and shows no figures.

Every count says its number in words to a screen reader, on the day, the chip,
the line and each cell. The figures themselves are hidden from assistive
technology, because the labels already carry them. The counts are numbers and
sentences, never a colour ramp.

### The founder's decisions (1 October 2026)

**1. The threshold is one.** Counts show once at least one other person has
answered with times. Below that, the line reads "You're the first to answer.
As replies come in, each day will show how many could make it." and nothing
else on the screen changes. The database function enforces this, not the
client.

_Accepted trade-off:_ **with exactly one other answer in, the counts reveal
that person's answer.** "1 free on Thursday evening" is then one person's
Thursday evening, not a combined result. The ticket recommended two. The
founder chose one so that the second person to answer gets something to work
from, and accepted the exposure. In a three-person group it identifies the
person too, because the reader knows who else was asked.

**2. "I'm easy" counts everywhere** (spec §5.6). A flexible answer adds one to
every day, block, overlap and half-hour count. The ticket recommended leaving
it out and mentioning it once in the line.

_Accepted trade-off:_ flexible answers raise every number by the same amount,
so on a day nobody picked the figure is the flexible count, not nothing, and
"Nobody else has picked this day yet" only shows when nobody said "I'm easy"
either. That is accurate, because the engine counts a flexible member as
available for anything.

_Decided here:_ **flexible answers alone do not meet the threshold.** A count
made only of "I'm easy" answers would be the same number on every day and
every half hour, which says nothing about which day to pick. Until somebody
gives times, the line reads "Nobody else has given times yet. As they do, each
day will show how many could make it." when others have answered without
times, or the first-to-answer line when nobody has.

**3. "Free" means any half hour.** A block counts somebody if they have any
half hour inside it, and a line of the answer counts somebody if they share
any half hour with it. The plan's duration does not matter. This matches the
mockup. The ticket recommended counting somebody only where the shared stretch
is at least the plan's duration, as §5.6's "windows fully contain it" does.

_Accepted trade-off:_ "Overlaps with 3 others" can be three people who each
share a different half hour with the reader, none long enough to hold the
catch-up. The figure over each cell is exact about how many are free in that
half hour, and the sentence names the hours with the most. The candidates
screen still applies §5.6.

Counts are of **distinct people**. Somebody free 6–7 pm and somebody free
8–9 pm are two people over 6–9 pm, though no half hour has more than one of
them. The domain owns all of this (`packages/domain/src/availability/others.ts`).

### What the function returns

`public.others_availability(plan_id)` is a `security definer` function in one
file (ADR 0015), callable by `authenticated`. Guests are anonymous sessions,
and they are members too. It checks that the caller is an active member of the
plan's circle and returns null otherwise, so a non-member, a removed member
and a plan that does not exist cannot be told apart. `anon` cannot call it.

It returns:

- how many the current revision asks (`plan_participants`, active members:
  the engine's roster, so "5 of 6" here matches everywhere else);
- how many of the others have answered it, how many with times, and how many
  said "I'm easy";
- whether the caller has answered it;
- **for each other person who gave times, one entry per day: that person's
  windows on that day.**

The last item was not in the ticket. The ticket asked for counts per half hour
and said the result should hold no individual window. Distinct-person counts
over a block or a line of the answer cannot be worked out from counts per half
hour, as the example above shows. The overlap also depends on what the reader
is painting at that moment, so the server cannot work it out in advance
either. **The founder decided (1 October 2026) that the result holds anonymous
per-day windows**:

- no user id, no name, no response or window id;
- nothing links one day's entry to the same person's entry on another day.
  Entries are ordered by the times in them and never by who gave them, so
  their order carries nothing a reader cannot already see in the times;
- never the caller's own answer;
- only answers to the current revision, from people it is still asking;
- an empty list below the threshold.

_What this exposes beyond counts per half hour:_ counts per half hour already
show where windows start and end on a day. An entry adds **which start goes
with which end**, and which windows on one day belong to one person. With
threshold one and one other answer in, the entries are that person's answer,
day by day, and the founder accepted that under decision 1.

The ticket's acceptance line "nothing … in the function's result … holds an
individual window" is amended to: the function's result holds no identifier
and no link between one person's days. The screen, logs and analytics still
hold no individual window and name nobody.

The alternatives were counts only, with "free" meaning "the most free at once"
(this changes decision 3's meaning: the example above would say 1, not 2), or
sending the reader's unsent cells to the server on every edit. The second
sends a draft off the device before Send, does not work offline, costs a
request for each paint, and leaks the same information through repeated
queries.

### Why this is not the heat map manifesto §3.4 forbids

§3.4 forbids "heat maps and overlap grids the organiser has to interpret", in
service of "we recommend, we don't decide". These counts are for the person
**answering**, not the organiser. They are numbers with a sentence that says
what they mean, not shading. The organiser still never interprets one: the
candidates screen is unchanged and still names who is in and who is out for
each option, and the editor recommends nothing and pre-fills nothing.

### The attribution limit

A member who reopens the editor each time an answer arrives can tell what the
newest answer added to the counts, and so can attribute it to whoever answered
in between. The waiting screen already shows who has answered. This is
accepted. It exposes nothing a member will not see on the candidates screen,
which names who is in for each option. It is still a change to what is visible
**before** answering, and it is written down here for that reason. The editor
reads the counts once each time it opens and does not update them live
(SUS-129, out of scope), which makes this harder to do but not impossible.

## Alternatives considered

- **Threshold two** (the ticket's recommendation). Rejected by the founder: the
  second person to answer would get nothing to go on, for a protection that
  the candidates screen gives up a few answers later.
- **Leave "I'm easy" out of the counts** and mention it once in the line.
  Rejected by the founder in favour of §5.6's meaning of flexible.
- **Count only shared stretches as long as the plan.** Rejected by the founder
  in favour of the mockup's "any half hour", which a guest can read without
  knowing the plan's duration.
- **Counts per half hour only, from the database** (the ticket's shape). This
  cannot give distinct-person counts for a block or for the reader's answer.
  It was kept as the fallback if the founder had preferred "the most free at
  once".
- **Loosen RLS** so members read each other's windows. Rejected: that would
  hand over identities with the windows, which this design avoids.

## Consequences

- Spec §5.5 gains a bullet for the counts, the threshold and the
  first-to-answer line. Spec §8.2 gains an invariant: availability is shown
  to other members only as counts and anonymous per-day windows, from the
  current revision, never with an identity, and only once one other answer
  with times is in. Spec §11.3 lists `availability_others_read(others_shown)`.
- One new function and one migration (`0030_others_availability.sql`). No
  table, column or policy changes. `plan_responses` and `willing_windows` stay
  owner-only, and pgTAP proves it again.
- A new event, `availability_others_read(others_shown)`, is sent once each
  opening's read has settled, so the time to answer and the "I'm easy" share
  can be compared with and without counts. It carries a yes or no and never a
  count, date or time. It is a separate event rather than a field on
  `availability_started`, because the start is sent as the editor opens and is
  never held back for an optional read.
- The read is optional, like the usual times (ADR 0037). If it fails, is
  offline or has not arrived yet, the editor stays exactly as it was and the
  answer can still be sent. Nothing from it is stored on the device or put in
  the draft, and the windows sent are the same with or without it.
- What is stored, `submit-availability`, the engine, drafts and resubmit are
  unchanged.

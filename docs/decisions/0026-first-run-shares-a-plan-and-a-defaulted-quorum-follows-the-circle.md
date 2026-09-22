# ADR 0026: First run shares a plan, not an invite, and a defaulted quorum follows the circle

_Status: accepted · Date: 20 September 2026_

## Context

Spec §5.1 drew the first run as: name the circle, share the **invite link**, watch
people arrive on circle home, then make a plan. S1-22 (SUS-38) built exactly
that, and building it made the shape of the thing visible.

A bare invite asks six friends to join an empty circle. What it says in the group
chat is "install this idea", and what it gives them once they are in is a screen
with nothing on it, because the organiser has not planned anything yet — they are
waiting on the arrivals. The organiser therefore shares twice: once to get people
in, once to ask the question. Two links in one chat, and the first one carries no
reason to tap it.

A plan link carries its own reason. "When are you free?" is the question the
group chat was already failing to answer, and [ADR 0022](./0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)
already makes a plan's link admit new members while the plan is taking answers:
tap it, add a name, answer, and you are a member of the circle and one of the
people that plan is asking, in one step. S1-24's own note called joining after
the plan exists "the common case". The machinery is built; the first run was
still pointing at the other door.

The quorum is what stopped this being a pure routing change. A plan's quorum is
resolved once, when it is created, from the circle's active member count —
`body.quorum ?? circle.default_quorum ?? quorumDefault(count)`. On the invite-first
flow that count was whatever had arrived while the organiser waited. On a
plan-first flow the count is **one**: the organiser, alone, a second after making
the circle. `quorumDefault(1)` is 2, it is written into the plan, and it never
moves again. The first friend to answer would make the plan `ready`, and the
organiser would be shown a "best time" for two people while the other five were
still reading the message.

So a plan made before anybody has joined needs a quorum that is a placeholder
rather than an answer, and something has to move it as the circle fills.

## Decision

**1. First run is plan-first.** `FirstCircle` is followed by `FirstPlan`, then the
share screen, and the organiser goes straight into the availability editor for
the plan they just made. The first session ends with the question asked and one
answer already in it. Spec §5.1 and §6.1 are rewritten to this order.

**2. The invite link is a secondary door, not a step.** The invite screen stays in
the product — a circle that already exists still needs a way to add somebody
without a plan — and it is reached from circle home and settings (S1-23). It
leaves the first run, and `FirstPlan` keeps a quiet "Just invite people for now"
for the organiser who does not want to plan yet. `CircleHomeJoining` stays for
that path and leaves the first run with it.

**3. A plan records whether its quorum was chosen or defaulted**, in
`plans.quorum_source` (`'chosen' | 'defaulted'`). `create-plan` writes
`'defaulted'` only when neither the request nor the circle supplied a number.

**4. While it is defaulted, the quorum follows the plan's audience.** Every join
through `join-plan` recomputes it from the number of people the plan is asking —
its participants at the current revision, not the circle's roster — and applies
it as an **adjustment** ([ADR 0017](./0017-changing-a-quorum-or-a-deadline-adjusts-a-plan-it-does-not-revise-it.md)):
no new revision, answers kept, and the candidate set restaled and recalculated in
the same request as any other adjustment.

The audience rather than the roster, because the two come apart in both
directions. Somebody who joins by the circle's invite and never opens the plan
was never asked (spec §9 makes joining an active plan an opt-in), and counting
them would put the quorum above the people who can answer — a plan that can
never reach it. And a circle's other plans are untouched by a join to this one,
because their own audiences did not change. The rule is a pure function in
`packages/domain` and a Postgres function that is authoritative, as AGENTS.md
requires of a transition guard.

**5. The rule while defaulted is `max(3, quorumDefault(active))`.** Not plain
`quorumDefault`. `quorumDefault(2)` is 2, so on a brand-new circle the first
friend to answer would take the plan to `ready` — the failure this ADR exists to
prevent, reintroduced one member later. Three is the floor `memberLimits.min`
already names as the point where "most of us" stops meaning "both of us", and
it is a floor rather than a target: at four and five members the rule is still 3,
and from six it is `quorumDefault` again (6→4, 8→5, 12→8).

A circle that genuinely is three people is the cost. Its plan needs all three,
which is a real constraint and a visible one: the no-quorum resolution already
offers **Lower to N people** (§5.7), one tap, and taking it is an explicit choice
that turns the quorum into a chosen one.

**6. Any explicit quorum change makes it chosen, permanently.** `revise-plan`
setting a quorum writes `quorum_source = 'chosen'` in the same statement, and a
chosen quorum never moves by itself again — including back down, and including
when the circle grows. The organiser's number is the organiser's number.

## Alternatives considered

**Leave the quorum resolved at creation, and have the first run wait for members
before planning.** This is what the invite-first flow was. It keeps every rule
simple and costs the thing the change is for: the organiser shares twice, and the
plan is made in front of an audience of nobody.

**Recompute the quorum on read, from the current member count, rather than
storing it.** Tempting, and wrong in the same way a computed deadline would be:
the quorum is an input to `ready`, to the candidate set and to the emails that
have already gone out. A number that changes when you look at it cannot be
reported, cannot be tested against a stored candidate set, and would silently
rewrite the meaning of a confirmation made a minute earlier. Storing it and
adjusting it keeps one writer and one audit trail.

**Recompute on every membership change, including removals.** This ADR moves the
quorum on **joins** only. A removal that lowered the quorum would make a plan
`ready` as a side effect of somebody leaving, which is the same surprise as
`ready` on two people and lands at a worse moment. A removal leaves the number
where it is; the organiser can lower it.

That has a consequence worth stating, because the first implementation missed
it: a defaulted quorum only ever **rises**. Recomputing from the audience alone
would let the next join after a removal lower the number on the removal's
behalf, which is the same side effect arriving one step later, so the recompute
is clamped to the quorum already stored.

**A `null` quorum meaning "defaulted", instead of a second column.** It collapses
two facts into one and loses the current number, which `ready`, the candidate set
and "N of M replied" all read. Every one of them would have to learn the rule and
recompute it, which is the recompute-on-read alternative wearing a different hat.

**Cap the defaulted quorum at the active member count**, so it never exceeds the
people who could answer. It reads kinder and it defeats the purpose: on a circle
of two it is 2, which is `ready` on the organiser plus one friend.

## Consequences

- A first plan on a circle of one stores quorum 3 and moves as people join. Until
  three people are in, it cannot go `ready` — which is the intent, and is
  exactly the state the waiting screen already describes.
- `plans` gains a column, its migration and its pgTAP tests. `join-plan` gains a
  write it did not have; it stays inside the existing definer function, so the
  adjust path remains the only writer of a quorum.
- The join path now does more work per join. It is bounded — one adjustment, the
  same one an organiser makes by hand — and it is skipped entirely once the
  quorum is chosen.
- `FirstPlan`'s "adjusts as more people join" becomes true. It was written as a
  description of `quorumDefault` at creation time and has been describing
  something the product did not do.
- An organiser who lowers the quorum once stops getting the automatic rule, with
  no way back short of another explicit change. That is the trade for the
  guarantee that their number sticks.
- [ADR 0022](./0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)
  is unchanged: what a plan link authorises, and for how long, is untouched. This
  ADR only makes that link the one the first run shares.

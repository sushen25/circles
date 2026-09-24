# ADR 0012: A circle holds up to twenty active members

_Status: accepted · Date: 10 September 2026 · its line on the quiet-ask threshold is corrected by [ADR 00XX](./00XX-the-quiet-ask-at-twenty-members.md)_

## Context

Spec §3 fixed the group size at "3–12 active members per circle", and
architecture §6.2 and §8.2 carried the same twelve as a trigger on
`circle_members`. The number came from the candidate cards and the quiet-ask
threshold being designed for that range, not from a constraint of the product.

Twelve turns out to be small for the groups this is for. A book club, a team's
social circle or an extended family runs past twelve without becoming a
different kind of group, and the alternative — two circles for one set of
people — splits the availability that makes the engine work at all.

## Decision

**A circle holds up to twenty active members.** The floor of three, which the
quorum defaults rest on, is unchanged.

## Alternatives considered

- **Leave it at twelve.** Rejected by the founder: the limit was excluding
  groups the product is for, and nothing in the design actually breaks at
  thirteen.
- **No cap.** Rejected: the availability grid, the members list and the
  quiet-ask threshold all assume a group you can hold in your head, and an
  uncapped circle is a different product with different privacy questions —
  every member can see every other member's name.
- **A cap per plan rather than per circle.** More complex and solves nothing
  the circle cap does not: the cost that scales is the roster, not the plan.

## Consequences

- `quorumDefault` needs no change: `max(2, ceil(n × 0.6))` gives 12 of 20, which
  is the same proportion it gives at every other size.
- The candidate cards show avatars for the available set, which can now be
  twenty. The design's marks row already scrolls; whether it still reads well at
  twenty is a design question for the client tickets, not a schema one.
- The quiet-ask threshold is a proportion of the circle, so it moves with the
  cap on its own.
- Two copies of the number exist and always will, because one is SQL and one is
  TypeScript: `public.member_cap()` and `memberLimits.max`. Both are named
  rather than inline, and `010_circles.sql` fills a circle to exactly
  `member_cap()` and asserts the next insert fails, so a change to one without
  the other is a failing test rather than a silent divergence.

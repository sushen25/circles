---
adr: 62
title: "A Continue-as pick does not hand the taker the previous holder's quiet-ask answer"
status: proposed
date: 2026-10-11
amends: [49]
---
# ADR 0062: A Continue-as pick does not hand the taker the previous holder's quiet-ask answer

_Status: proposed · 11 October 2026 · amends [ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md) (what a list move carries), and spec §5.4_

## Context

[ADR 0006](0006-continue-as-reattachment-without-owner-approval.md) and
[ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md) accept that
a person who picks a guest's name from the Continue-as list takes that guest's
place, and that this proves nothing about who they are. They considered the
roster, the plans and the availability that go with the place. They did not
consider that `private.move_membership` also moved the member's answer to a quiet
ask (`private.plan_interest`) to the new holder.

That answer reaches the taker's screen. `quiet_viewer_facts` returns it as the
viewer's own answer, which decides whether the screen says "you answered" and
which keen-only actions it offers. So a person who proved nothing could read
another member's individual interest answer, which the product treats as never
exposed to anyone else (AGENTS.md; spec §5.4).

## Decision

1. **A pick from the Continue-as list does not carry the interest answer.** The
   taker starts with no answer to any quiet ask in the circle.
   - While the ask is still `seeking`, the previous holder's row is deleted, the
     way removing a member deletes it. The real member can answer again, and is
     not counted twice.
   - Once the ask has opened, interest is closed and the count shown is the one
     it opened with. The row stays where it is, under an identity that is no
     longer a member of the circle: still counted, readable by nobody.
2. **Every move that proves the person carries it, as before.** That is a move
   made with an emailed re-entry link (including a take-back from a saved
   account) and `claim_identity`, where somebody saves their own place.
3. The choice is made by the caller, because `private.move_membership` decides
   nothing. `reattach_member` sets a transaction-local switch
   (`circles.carry_interest`) off for a list pick and back on after the move; it
   is on by default.

## Alternatives considered

- **Delete the row on every list pick, opened or not.** Rejected: it would change
  the count of an ask that has already opened, which is fixed at the moment it
  opened.
- **Leave the row under the old identity while the ask is `seeking`.** Rejected:
  the real member could then answer again and be counted twice towards the
  threshold, the one number a quiet ask turns on.
- **Add a parameter to `move_membership`.** Rejected for now: it would mean a new
  overload of a function three callers share; the existing moves already use
  transaction-local settings for the same purpose
  (`circles.takeback_email_hash`).

## Consequences

- A takeover of a place in a circle with a `seeking` quiet ask can lower that
  ask's count by one, until the real member answers again. This is the same
  effect removing the member has.
- A member who comes back with an emailed link after a takeover finds their old
  answer gone from a `seeking` ask (they can answer again) and, on an ask that
  has already opened, not recoverable. An open ask no longer takes answers.
- The emailed-link path still moves whatever the current holder has. If a taker
  answered a quiet ask and the real member then returns by link, that answer
  moves to the real member. The mailbox proved the person returning; the taker's
  answer is the cost of the taker having held the place. Closing that needs the
  chain of moves, and is not done here.
- The row an opened ask keeps belongs to an identity with no membership left. If
  that identity has nothing else, retention deletes it after its usual period and
  the row goes with it, so the shown count of an opened ask can fall by one then.
  The same happens today when a member is removed from a circle after it opened.
  Keeping the count independent of the identity needs the count stored on the
  plan, which is a larger change than this one.
- Availability and willing windows are unchanged: members already see availability
  by name.
- Spec §5.4 and ADR 0049 say so.

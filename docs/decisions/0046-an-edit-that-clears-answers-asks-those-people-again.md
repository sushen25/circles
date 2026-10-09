---
adr: 46
title: "An edit that clears answers asks those people again"
status: proposed
date: 2026-10-01
---
# ADR 0046: An edit that clears answers asks those people again

_Status: proposed · 1 October 2026_

## Context

An organiser's edit to the window, the daily band or the duration starts a new
revision, and every answer to the old one stops counting (spec §5.3). The edit
writes `planning.plan_revised` to the outbox. Nothing read it. The architecture's
`revise-plan` row promised the edit was "invalidating responses and enqueuing a
re-ask", and the re-ask was never built. The only prompt was the organiser's own
"Ask {circle} again" screen, and somebody who has already answered has no reason
to open the group chat's link a second time (SUS-131).

SUS-130 made the plan explain itself to somebody who comes back: the grid and
circle home say "The plan changed, so the times you sent were cleared". This is
what brings them back.

Spec §5.8 lists the plan-update emails a verified subscriber receives and says
"Never anything else". So a letter about an edit is a rule change, and so is a
new push.

## Decision

1. **A new kind, `asked_again`**, written once per revision when an `edit`
   moves the plan to a new one. `ONCE` plus the revision in the idempotency
   key, as `options_ready` does, so a run of edits is one message per question
   asked and a retry is none.
2. **Its audience is the people whose answers were cleared**: participants who
   answered an earlier revision of this plan and have not answered the current
   one. That is SUS-130's definition (the reader's newest answer is to an
   earlier revision), so the email and the screen agree about who was asked
   again. The organiser who made the edit is left out. People who never
   answered are left out too: nothing of theirs was cleared, and the deadline
   reminder already covers them.
3. **A member kind, like `changed`**: push first, then email only on a
   verified subscription to this plan, which keeps the subscription's stop link
   and re-entry link. Muting the circle stops it. Quiet hours hold it until
   08:00, because being asked again is not urgent at midnight.
4. **An `adjust` (quorum, deadline, required members) sends nothing.** It is
   the same event name, and the event's `action` tells the two apart. An
   `adjust` keeps the revision and every answer (ADR 0017).
5. **Nothing about a question that has been replaced or closed.** The drain
   writes nothing for an edit the plan has already moved past, because the newer
   revision's own event says what is true. The sender skips a job whose
   revision is behind the plan's, one whose plan has stopped taking answers
   while quiet hours held it, and one whose recipient has answered the new
   question in the meantime.
6. **The letter says what the plan asks now**: its dates and daily hours, read
   from the plan as it is. It also says the earlier times were cleared, and its
   button opens `/j/<code>`, where the grid explains its empty state. It says
   nothing about other people's answers, because after an edit nobody has
   answered the new question yet (SUS-129).
7. **A reopen ("Change the time", §5.7) sends `changed` and nothing more.** It
   emits `confirmation.meetup_rescheduled`, not `plan_revised`. Its letter
   already says the time is off and asks for new times. It goes to every
   subscriber, which includes everyone whose answer the reopen cleared, so a
   second letter would only repeat it.

## Alternatives considered

- **Only the people who answered the revision just replaced.** Somebody who
  answered revision 1, was asked again and did not answer revision 2, would
  hear nothing when revision 3 replaced it. The ticket asks for one letter per
  revision to such a member, SUS-130's screen still tells them their times were
  cleared, and the organiser's preview already names them as asked again
  (spec §5.3: "including anyone who had not yet answered"). One letter per
  edit, and an edit is a new question.

- **Every participant, answered or not.** This was the ticket's first sketch.
  It would write to people who had nothing cleared, about a question that
  `new_plan` and the deadline reminder already ask them, and the email would
  disagree with SUS-130's screen about who was asked again.
- **Carry the audience on the event**, computed in `revise_plan` under its
  lock. This is exact for the moment of the edit, but it puts a list of member
  ids on a row that analytics also reads, and it changes a function SUS-133 is
  about to rework. `dispatch_context` can answer the same question when the
  event is drained, and it leaves out anybody who has re-answered by then.
- **Send `asked_again` on a reopen as well.** That is two letters for one
  change, and `changed` already says everything except "your earlier times
  were cleared". Both of them land on the grid, which says that.
- **Name how many people will get an email on the organiser's re-share
  screen.** The organiser cannot read subscriptions (they are private), so this
  would need a new function. The screen says instead that anyone with updates
  on is told and everyone else needs the link.

## Consequences

- Spec §5.8 lists "asked again after an edit" among the pushes and the
  plan-update emails. The architecture's `revise-plan` row and §13 say what
  was built.
- `jobs.notification_jobs` accepts `asked_again` (migration 0031), and
  `dispatch_context` returns `answered_earlier`, which is ids only.
- The organiser's "Ask {circle} again" screen after an edit says that anyone
  who had answered has to answer again, that anyone with updates on is told
  (by push or email, whichever reaches them), and that the chat reaches
  everybody else.
- Push for this kind is written like every other member kind's and goes out
  when push delivery does (S3-03). Its copy key is `push.asked_again`.

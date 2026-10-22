---
adr: 90
title: "The first run is four screens to the share, and the organiser answers their own plan first"
status: accepted
date: 2026-10-22
amends: [26, 53, 76, 84]
---
# ADR 0090: The first run is four screens to the share, and the organiser answers their own plan first

_Status: accepted · 22 October 2026 · amends [ADR 0026](0026-first-run-shares-a-plan-and-a-defaulted-quorum-follows-the-circle.md) (the exits from the first plan, §2), [ADR 0053](0053-the-organiser-gate-moves-to-before-the-share.md) (the order, the draft's record, the gate's wording, §1, §3, §4, §5), [ADR 0076](0076-day-based-deadline-defaults-round-up-to-the-hour.md) (the default deadline's hour) and [ADR 0084](0084-a-campaign-tag-labels-a-circles-cohort-row-never-a-person.md) (where the source question is asked); spec §5.1, §5.3, §6.1 and §11.2 change with it_

## Context

Testers of the first run said, on 22 October 2026, that it is "too complicated and
confusing". Counted, it has ten screens from **Start a plan** to circle home, and the
link the organiser came to make appears on the eighth. Its labels promise things that
do not happen: **Create Thursday Lot** creates nothing (it is a draft until the code),
**Ask the group** opens an email form, and **Step 2 of 2** is followed by six more
screens. Its first plan is a settings form: eight choices, three **Change** buttons
that open the same setup, and a quorum line nobody can change.

Sushen decided with the prototype in front of him that what confused people was too
many steps and too many words, and that the product rules behind them may change
through one record. This is it. The things that stand are as stated at the end.

## Decision

**1. The order.** A new organiser sees five screens: **who it is for**, **which
evenings**, **who's asking**, **the code**, and **the share**. A signed-in organiser
sees three: who, evenings (its primary is **Make the link**), and the share. Each
screen has its heading, one control and at most one short line, and no kicker above
the heading. A 2 px line under the top bar, with "1 of 3" beside it, says where the
person is; the share has none. (ADR 0053 §1, whose order was circle, plan, save,
name, share, own times.)

**2. The draft holds the organiser's answer.** The record becomes **version 3**: it
adds `answer`, the days the organiser picked on the plan's own calendar and the time of
day they chose in Adjust, or the fact that they chose to add theirs later, and it
adds an idempotency key for the answer. The finish makes the circle, then the plan,
then **submits the answer after `create-plan` under that key**, and clears the draft
only when all three are done (ADR 0016). Days that went by while the organiser signed
in are dropped; if none is left the answer is **skipped, not refused**, and the plan
is still made and shared. An answer the server refuses for a reason of its own is
skipped the same way; a connection that dropped, or a rate limit, is tried again.
A **version 2 record** still in a browser reads as a draft with no answer (and the way
on it carried is not carried on: see 4); a version 1 or an unknown record reads as no
draft, as before. The answer is the organiser's own times, so it is the same
`availability_submitted` event as anybody's, once, at the finish. (ADR 0053 §3.)

**3. The gate asks the first name with the email.** The name is saved to the profile
once the code is accepted and before `create-circle`, together with the device's zone,
and only into a profile still at its defaults: a returning account keeps its own. **Your
name is skipped** when the gate supplied one; it stays for an account that reaches the
finish with no name and no gate (a guest account saved by another door). SSO (SUS-77)
supplies the name later. (ADR 0053 §1, §4.)

**4. "Just invite people for now" and "See if people are keen instead" leave the first
run.** Both stay on circle home and in settings, where they were always also reached.
A circle made in the first run always has a plan, so a draft no longer carries "a way
on"; a version 2 record that did is read as the ordinary one. (ADR 0026 §2, ADR 0053
§5.)

**5. Cadence leaves the first screen.** A new circle is **monthly**, as it was before
anybody chose; it is changed in circle settings, where it always could be.

**6. The source question is asked after the share.** "How did you hear about {brand}?"
is a quiet card under "Over to {group}." once the share sheet has closed: optional,
once per account, skippable, "Only counted, never tied to you." A tagged arrival
records `organiser_source(content)` there without asking. The event, the account's
"asked" row and the funnel's "not answered" bucket are as ADR 0084 left them. (ADR 0084's
amendment of 21 October, "the last step", and ADR 0061's "never gates anything",
applied once more.)

**7. The gate drops its summary of the drafted plan.** The progress line and Back show
that nothing is lost, which the summary was there to say. (ADR 0053 §4.)

**8. No time zone in the first run.** It is the device's, saved with the name, and
editable in Account (spec §5.1 step 4, which named it).

**9. Monthly is the first plan's default window.** A new preset, `next_28_days`, is
the next four weeks, with the evening band a fortnight gets (most of it is weekdays),
inside ADR 0047's thirty days. The chips are **Monthly**, **Next 2 weeks** and **This
weekend**. Tonight leaves the first run and stays in the full setup, where **Next 4
weeks** is a chip beside the others. A quiet ask picks from its four windows as before.
`plan_created`'s `window` gains `next_28_days`, declared in the catalogue first.

**10. The new-plan share message is shorter.** "When can {circle} actually catch up?
Pick the times you'd be up for, no app needed: {link}": eighteen words with the link,
where it was twenty-seven. A window that is not the monthly default goes in the first
sentence ("in the next two weeks", "this weekend").

**11. The default reply deadline is 6 pm.** Every day-based default lands at **6 pm on
the plan's own clock**: tomorrow for this weekend, the next 7 days and a custom window,
**the third day after** for the next 14 days and the next 28, instead of on the hour
(the founder saw "Mon 19 Oct, 01:00"). Counted in calendar days from the day the plan
is made, so a daylight-saving change still lands on 6 pm and a plan made on Thursday
morning or on Thursday night closes on Sunday at 6 pm. Never after the last possible
start, and tonight keeps its hour and its margin (ADR 0010). This replaces ADR 0076's
rounding up, which rejected 6 pm because a plan made at 7 pm would get nearly
twice the time; that is now the cost accepted, for a time a group chat reads as a
promise somebody made. Existing plans are untouched.

**Unchanged on purpose.** Nothing is created before the code is accepted, and
abandoning before it creates nothing (ADR 0004, 0053 §2). The draft survives a
reload and the mail round trip, and expires 24 hours after it was last changed. The
plan is shared first, with a defaulted quorum (ADR 0026). The terms line. The funnel
events `organiser_draft_started`, `organiser_gate_shown` and `organiser_gate_passed`,
with their empty payloads, now fired on the first screen, the third and the code.

## Motion

Manifesto §5.5 gains the first run's own rules, which are the ticket's numbers: steps
slide 12 px and fade in over 200 ms on `cubic-bezier(0.23, 1, 0.32, 1)`, the screen they
replace leaves in 140 ms, and Back runs the other way; the progress line grows by
`scaleX` in 200 ms; a press is `scale(0.97)` in 120 ms; picking a day is immediate; the
Adjust sheet rises on the drawer curve in 200 ms and leaves in 160; Copy becomes Copied
in a 2 px blur crossfade; nothing animates on arrival at the share; reduced motion
keeps the fades and drops every movement. The confirmation screen keeps the product's
one moment of arrival.

## Alternatives considered

- **Keep the gate before the plan's own times.** Asks a stranger for an email before
  they have said anything about their evenings, which is the wall ADR 0053 took down.
  The organiser's own times come first and are held in the draft.
- **Send the organiser's answer to the server as they pick it.** Needs a plan, and a
  plan needs a circle and a saved place; this is the order ADR 0053 exists to avoid.
  The draft is the store, as it is for everything else before the code.
- **Keep Your name as its own screen after the code.** A fourth typed screen for one
  field the gate can ask beside the address, and a screen between the code and the
  link. Asked with the email, it costs no screen, and the name is saved before the
  circle is made, which is when it is needed.
- **A single route with a step counter, instead of a route per screen.** A reload
  and Back would need a second source of truth for "where am I". Each step stays its
  own route, and the screen that is leaving is told to go (`useLeave`) before the
  navigation runs.
- **Keep 24 hours or 72 hours and show them rounded to 6 pm.** Rejects itself: "about
  three days" is what the founder asked for and what the screen shows.

## Consequences

- Spec §5.1 (the first-time organiser flow, the gate paragraph, the source question,
  the acceptance criteria), §5.3 (the window and the deadline defaults), §6.1 and §11.2
  change in the same PR, and so do the canvas artboards (`docs/design/gen.py`) and the
  features README table.
- A new organiser reaches the share on the fifth screen, a signed-in one on the third.
  The typed inputs are the group's name, a first name, an email and the code.
- `create-plan` accepts `next_28_days`; no migration is needed, because a plan stores
  its dates and hours, never the word for the window.
- The draft record is version 3 and reads version 2; the answer's key is made on the
  first read of a version 2 record and written back, so a reload does not make another.
- The message bubble is a shared component (`MessageBubble`): the first screen, the
  share and circle home draw the same message. `Input` gets an ink focus border in
  place of the browser's blue ring, and the code boxes send themselves on the sixth
  digit everywhere a code is entered, with no Continue button.
- The e2e journeys read the new order, and the plan lifecycle's deadline label reads
  6 pm.

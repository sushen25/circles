# ADR 00XX: The cadence nudge is decided once per due date, when circle home says it is about time

_Status: proposed · 25 September 2026_

## Context

Spec §5.9 had the cadence nudge in two sentences that did not quite agree:
"seven days before a monthly … due date … one person is nudged", and "one
push or email at the due date if no plan exists". It offered "Snooze one
interval", where the CircleHomeDue artboard's button, and the ticket (S2-04),
say **Snooze a month**. And it did not say what happens when the person the
policy names has turned "Nudges to plan the next one" off — the switch S1-23
added to notification settings, which nothing read until now (SUS-83).

S2-04 is the ticket that sends the nudge, so each of these had to be one
thing. Two facts about the pipeline shaped the answers:

- The idempotency key is per recipient. A second pass that chose somebody
  else for the same due date — because the first person turned nudges off
  in between — would write a second job under a second key, and two people
  would each be told it was their turn.
- `jobs.run_retention` deletes jobs after thirty days, and a two-monthly
  circle stays due for longer than that. A job cannot be the record that a
  due date has been prompted.

## Decision

1. **One decision per circle per due date**, recorded in
   `private.cadence_prompts` (circle, due date, who was asked and why) by
   `public.dispatch_prompt_cadence`, which writes the decision and its jobs in
   one transaction under the circle's row lock. A due date already decided is
   never decided again, whoever it went to. The row is keyed on the meetup the
   cycle counts from (`last_met_at`), not on the date: a nudge that works has
   the circle meeting *before* the date it was asked for, and only the meetup
   tells that cycle from the next. So an owner who changes the cadence after
   the nudge went moves the date and not the decision — nobody is asked twice
   about one meetup — and circle home's "it's your turn" reads only the
   current cycle's row.
2. **It is made when circle home first says "About time for the next one"** —
   the domain's `nudgeDueDate`, which is `cadenceState`'s `due_soon`: the lead
   days before the due date (a week for the monthly cadences, two days for
   the short ones), with a goal, a history, no plan open and no snooze. The
   one message is sent then (quiet hours apply), not on the due date itself:
   the nudge and the card are one moment, and a card that has been asking for
   a week before its message arrives is two.
3. **A plan open suppresses it**, at the decision and again at the moment of
   sending: `seeking`, `collecting`, `ready` or `confirmed`. A confirmed plan
   whose evening has passed and whose outcome nobody has reported counts too —
   the circle may well have just met. The sender also holds a queued nudge
   for somebody who has since turned nudges off or left, and for a circle
   snoozed or met in the meantime (`nudgeHeld`).
4. **A no is a no.** Under "whoever organised last" and "the owner" the
   policy names one person; if they have turned nudges off (or muted the
   circle), nobody is asked, and the decision is recorded as nobody so the
   sweep does not ask again every minute. Under take turns a person who said
   no is skipped and the turn passes on. The owner remains the fallback for
   every other dead end — a last organiser who has left, a meetup nobody was
   recorded at, a person no letter can reach (no confirmed address, or one
   that bounced) — while the owner has not said no too. Out of reach is not a
   no: under take turns it passes the turn on, and the one asked is always
   somebody something was sent to.
5. **Take turns is round-robin from the last organiser's place** in join
   order among the eligible attendees of the last meetup that happened,
   wrapping round. It had been "the first attendee who is not the last
   organiser", which alternates between two people for ever.
6. **Snooze a month** is one calendar month from now, the owner's (a circle
   setting, like cadence), and it moves `cadence_snoozed_until` and nothing
   else: the due date stays where `last_met_at` put it.

## Alternatives considered

- **Send on the due date itself.** Then the card says "About time" for a week
  before the message the card is about. Rejected: one moment, not two.
- **The ticket's `circles.cadence_prompted_for` column.** It would hold the
  date and not who was asked, which circle home needs for "it's your turn",
  and every member can select `circles`. A private table holds both and shows
  neither.
- **Fall back to the owner when the named person said no.** That hands the
  job to somebody else, which is exactly the labour the switch is for.
- **Re-evaluate a due date that found nobody, every minute, until somebody
  unmutes.** It costs a context read per circle per minute for a case whose
  right answer is silence, and would nudge somebody the moment they turned
  nudges back on — for a due date that may be weeks old.
- **Let any member snooze.** Snoozing quiets the prompt for the whole circle;
  it is the circle's setting and the owner's, as cadence and the nudge policy
  are. A member's own answer is "Turn off nudges".

## Consequences

- Spec §5.9 says when the nudge goes, what a no means, how take turns
  rotates, and "Snooze a month".
- `jobs.notification_jobs` carries a `circle_id` for `about_time`, which has
  no plan; `dispatch_claim_due` finds a nudge's circle through it, so
  archiving stops a queued nudge.
- A circle whose confirmed plan is never reported is never nudged. The
  morning-after question exists to prevent that, and the founder's
  diagnostics (S4-06) are where it would show.
- `private.cadence_prompts` is kept with the circle and is not part of
  retention: one row per cycle is a small record and is what keeps the
  second nudge from ever being sent.

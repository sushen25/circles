# ADR 00XX: Replies closed is told once per deadline and once a day later; one more day is a day from now, once per revision

_Status: proposed · 25 September 2026_

## Context

Spec §5.7 answers "nobody wants to decide" with one reminder at the deadline
and a screen with three ways out: lock in the top option, hand the plan to
someone else, or give it one more day ("extension never runs past the last
possible start"). S2-05 is the ticket that builds the screen, and building it
turned four loose phrases into decisions:

- **"One reminder at the deadline"** was implemented by S1-20 as a
  `replies_closed` letter with the occurrence `once` per plan revision. "Give
  it one more day" is an `adjust` (spec §5.3: a deadline change costs nobody a
  second reply), so the revision does not move, and the extended deadline's
  closure had the first one's idempotency key. The unique index swallowed it,
  and so did the sender's one-copy-per-address rule, which is keyed by kind,
  plan, revision and address. The organiser heard nothing the second time,
  and email is their only channel on the web (SUS-36 review round 5). The
  ticket also asks for a second reminder a day after the deadline if nothing
  has been decided, which the spec's "one reminder" did not allow for.
- **"One more day"** from what? The screen is usually opened hours after the
  deadline — from the letter — and a day counted from the deadline is then a
  few hours. And ADR 0010 lets a deadline sit *at* the last possible start, so
  there may be no day to give at all.
- **How many times?** A button that can be pressed every day is the stall
  this screen exists to end, with a nicer face.
- **A hand-off** changes who the organiser letters go to from the next tick
  (`dispatch_context` reads the plan), but a letter already queued names the
  old organiser's contact, and a `replies_closed` held overnight by quiet
  hours would reach somebody who has just let go of the plan.

## Decision

1. **`replies_closed` is once per deadline.** Its occurrence is the deadline
   the sweep saw (`occurrenceFor('replies_closed', { deadline })`), carried in
   the `planning.deadline_passed` event, so an extended deadline that passes
   again is a new letter and a retry of the same one is still swallowed. It is
   excluded from the one-copy-per-address rule on both sides of the wire
   (`dispatch_claim_due`, `NEVER_COLLAPSED`): it goes to one organiser's one
   contact, so there is no sibling to collapse, and collapsing by revision is
   exactly what dropped the second closure.
2. **And once more a day later, while the plan is still `ready`.** The sweep
   emits the same event with `follow_up: '+24h'` a day after the first letter
   was *announced* — not a day after the deadline, so a dispatcher that was
   down does not send both at once — and never more than a day late, so a plan
   that has sat undecided for a week is not reminded on the day this ships.
   `ready` only: the reminder is about an option waiting to be locked in. Not
   after a hand-off since the first letter: the new organiser's own letter
   said replies have closed, and a second one soon after is a duplicate. Its
   occurrence is the deadline plus `+24h`. That is two letters per deadline at
   most, which is what spec §5.8's "no repeated daily reminders" allows.
3. **A letter that has stopped being true is not sent.** At the moment of
   sending, a `replies_closed` for a plan that has since been locked in is
   skipped as `already_decided`, and one for a plan given another day while it
   waited as `replies_reopened`; any organiser letter to somebody who no longer
   organises the plan is skipped as `organiser_changed`. And a newer
   `replies_closed` takes the place of an older one still held: the drain skips
   the plan's queued ones as `superseded` before it writes the new one, because
   a job does not carry its deadline and at 08:00 both would look true.
4. **One more day is a day from the later of now and the deadline, never
   later than thirty minutes before the last possible start, once per
   revision.** `oneMoreDay` in the domain and `public.extend_deadline` in the
   database hold the same three rules. The margin leaves time to decide after
   replies close; the spec's "never past the last possible start" is its outer
   bound. When there is no day to give the answer is `no_time_to_extend`, and
   the screen says so rather than offering a button that does nothing. The
   revision whose day is spent is `plans.deadline_extended_on_revision`: an
   edit or a reopen asks a new question with a new deadline and earns a new
   day. The write is an `adjust` through `transition_plan`, announced as
   `planning.plan_revised` like any deadline change.
5. **A hand-off is a transition, `hand_off`, from `collecting` and `ready`**,
   guarded `organiser` and `hand_off_target`: an active member with a saved
   place (spec §8.2), one of the people the plan's current revision is asking,
   and not the organiser already. The organiser's letters go to the people a
   plan was addressed to, so a plan handed to somebody it never asked could
   never write to its own organiser. `public.hand_off_organiser`
   runs it and, in the same transaction, skips the old organiser's queued
   `options_ready`, `replies_closed` and `did_it_happen`. It announces
   `planning.organiser_changed`, and the new organiser is sent the one letter
   that says what is waiting for them: `replies_closed` when replies have
   closed, `options_ready` when there are options and replies are open, and
   nothing while the plan is still collecting — `options_ready` will reach
   them in its turn, its key naming the recipient. The hand-off letter's
   occurrence includes the hand-off event, so a plan handed back to somebody
   whose own letter was skipped when they let it go is told again, and
   `options_ready`, like `replies_closed`, is out of the one-copy-per-address
   rule — it too goes to one organiser's one contact.
6. **An extension does not reopen the deadline-approaching reminder.** Spec
   §5.8 allows "at most one deadline reminder per member per plan", and that
   kind is push-only until Slice 3. The ticket asked for it to be re-armed;
   the spec's rule stands.

## Alternatives considered

- **Keep `replies_closed` once per revision and bump the revision on an
  extension.** An extension would then clear every answer — the cost spec
  §5.3 says a deadline change must not have.
- **Decide in the dispatcher which closure this is.** A rule about which
  instance of a kind a message is would then live in two places;
  `occurrence.ts` exists to be the one.
- **Write the day-later reminder at the deadline, scheduled a day ahead.**
  The job would have to be taken back on every confirm, extension and
  hand-off, and a key cannot say which deadline it was for once the deadline
  moves. A sweep that asks "still ready a day on?" when the day comes needs
  none of that.
- **A day from the deadline, as the ticket wrote it.** Opened from the letter
  the next morning, that is a few hours, and opened two days later it is in
  the past.
- **Extension as often as the organiser likes.** The organiser can still move
  the deadline anywhere through Edit plan; the one-tap day is the rescue, and
  a rescue that repeats is the stall.
- **Hand-off from `confirmed` too.** Spec §9's "the organiser wants out" is
  broader than this screen, and a locked-in plan's organiser has the
  morning-after letter and the outcome. Left for when a screen asks for it.

## Consequences

- Spec §5.7 changes: "one reminder at the deadline" becomes one at the
  deadline and one a day later if still undecided, and the extension is
  written out.
- `planning.organiser_changed` joins the event catalogue, and
  `planning.transitions` has two more rows; migration 0027 carries both.
- The no-quorum screen offers "Give it one more day" once replies have
  closed, in the wider window's place, because a re-ask needs a deadline in
  the future and this is how the organiser gets one.
- `deadline_passed_action` gains `hand_off`.

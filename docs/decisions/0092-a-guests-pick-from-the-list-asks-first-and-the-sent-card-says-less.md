---
adr: 92
title: "A guest's pick from the list asks first, the Sent card says less, and the hours sheet stops saying free"
status: accepted
date: 2026-10-23
amends: [6, 67, 88]
builds_on: [54, 55, 66, 68, 79]
---
# ADR 0092: A guest's pick from the list asks first, the Sent card says less, and the hours sheet stops saying free

_Status: accepted · 23 October 2026 · amends [ADR 0006](0006-continue-as-reattachment-without-owner-approval.md) and [ADR 0088](0088-a-signed-in-account-can-continue-as-a-guest.md) (decision 5: a guest is asked too), [ADR 0067](0067-every-cadence-nudge-carries-a-stop-link-and-the-sent-card-says-an-account-is-made.md) (decision 5: the account line) and spec §5.5 (the quoted hours-sheet line)_

## Context

The founder asked on 23 October 2026 for the whole guest path to be looked at
again. A critique of it found three places where the words or the order promised
more than the product did, or spent a person's attention on the wrong thing.

1. **A guest's tap on a name moved a place at once.** [ADR 0088](0088-a-signed-in-account-can-continue-as-a-guest.md)
   decided an account is asked first ("Take Nina's place in Sunday Crew?")
   because a wrong tap is costly, and left the same step for a guest as "could be
   added later". The cost is the same for a guest: the place and its answers
   move off whoever held them, and the next tap on the list is theirs to undo.
   Spec §5.1 said reattaching happens "in one tap".
2. **The Sent card's account line was long and said "in {brand}".** ADR 0067
   fixed its exact words. The switch-off line, "Nothing is saved.", was untrue
   as well as flat: the answer is saved, and so is the place on that phone.
3. **The hours sheet said "free".** "Set when you're free", "Free from",
   "Free until", "Most others are free ...". Manifesto §3.3 rules out words that
   make a person account for their free time, and spec §5.5 quoted one of them.

## Decision

1. **A guest's pick from the list asks first.** Tapping a name on "Been here
   before?" opens a sheet, "Carry on as Nina?", with "Nina's times in Sunday
   Crew come to this phone." **Yes, I'm Nina** calls the reattach; **Not me**,
   Escape and the scrim close the sheet, send nothing, record nothing and return
   focus to the name. It is the sheet an account already gets (`ClaimPlaceSheet`),
   with a guest's words. `member_reattached` is emitted on Yes, as before, and
   not on the tap.
   Spec §5.1's "Reattaching moves the membership and its responses to the new
   session in one tap" becomes "in one tap and one confirmation", and its
   acceptance criterion "A guest who returns with no session can reattach in one
   tap" becomes "...can reattach with a tap on their name and a Yes". The owner's
   notice and the limits are unchanged.
2. **The Sent card's account line.** With the switch on, the line under **Save
   my place in {circle}** reads, exactly:

   > Makes you an account, so any phone gets you back in. Reminders to plan the next one can be stopped from the email.

   It names what is made, what it does for the person and the one thing it can
   send, and where it stops. With the switch off the line is "Your place stays on
   this phone." The button names both effects while the switch is on, **Email me
   and save my place**, and **Email me about this meetup** when it is off. The
   18+ line and its links are shown with the switch on, where an account is made.
   The same line is on **Keep your place for good**. **`CONSENT.text` is not
   changed, so its version stays `2026-10-06`**; this line is a notice about the
   account, as in ADR 0067, and `/privacy` already states the nudge.
3. **The hours sheet says what it asks for.** "Set the hours you'd be up for",
   **From** and **Until** in place of "Free from" and "Free until", and "Most
   others can do 6:30-8:30 pm." Each time button names its end for a screen
   reader ("From 5:30 pm", "To 10:30 pm"). Spec §5.5's quoted line changes the
   same way.

4. **The invite landing drops what it could not say truthfully.** Spec §5.1's
   "circle name, inviter's name, who is in so far, a one-sentence privacy
   statement, and the expected effort" becomes the circle's name as the
   heading, one sentence on what it is for, and who is in. Since ADR 0091 any
   member sends the invite, so the link cannot name who did, and the privacy
   promise is said on the name step and the answer screen. The button is **Join
   {circle}**.

Everything else on the guest path changed in the same ticket needs no rule: a
guest's way to the options is spec §5.6's, an answered guest's chat link opening
the options is what `/p/:code` already does, the locked-in refusal before a name
is what ADR 0054's preview already says, and the rest is words.

## Alternatives considered

- **No confirmation for a guest** (as before). Rejected: a wrong tap moves
  somebody else's place and answers, and it cannot be undone from the list.
- **Confirm only when the name has answered.** Rejected: the list carries no
  reply state, by ADR 0006, so the screen cannot tell.
- **Leave the account line as ADR 0067 wrote it.** Rejected by the founder: the
  reward, not the form, belongs at the high point, and the line was the longest
  thing on the screen.
- **A new token for the switch's outline.** Not needed: one colour, used once.

## Consequences

- A guest's pick takes two taps. A person who tapped the wrong name loses
  nothing.
- The Sent card is shorter and the account line is one sentence, rendered from
  `sent.makes_an_account`, the one place it lives.
- No migration, no new event and no change to `CONSENT`.
- The canvas artboards for Continue-as, Sent, the name step, the hours sheet and
  the locked-in screens are regenerated from `docs/design/gen.py`.

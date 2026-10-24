---
adr: 92
title: "A guest's pick from the list asks first, the Sent card says less, and the hours sheet stops saying free"
status: accepted
date: 2026-10-23
amends: [6, 48, 67, 88]
builds_on: [54, 55, 66, 68, 79]
---
# ADR 0092: A guest's pick from the list asks first, the Sent card says less, and the hours sheet stops saying free

_Status: accepted · 23 October 2026 · amends [ADR 0006](0006-continue-as-reattachment-without-owner-approval.md) and [ADR 0088](0088-a-signed-in-account-can-continue-as-a-guest.md) (decision 5: a guest is asked too), [ADR 0067](0067-every-cadence-nudge-carries-a-stop-link-and-the-sent-card-says-an-account-is-made.md) (decision 5: the account line, and where its reminders disclosure now lives), [ADR 0048](0048-the-consent-sentence-is-the-one-string-that-lives-in-config.md) (the card shows one of two sentences, each its own version) and spec §5.5 (the quoted hours-sheet line)_

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
   as well as flat: the answer is saved, and so is the place on that phone. The
   first fix, a shorter account line, still left the card at about sixty words
   of small print, and the founder asked for it to be trimmed hard (decision 2).
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
2. **The Sent card is trimmed to one fine print.** On 23 October the founder
   looked at the card as built and said there was too much text on it, and chose
   "trim hard, new consent". The card now reads:

   > **Hear when it's locked in?** · an address field
   > **Save my place in {circle}** (switch, on) · Gets you back in from any phone.
   > Emails about this meetup, plus a nudge when it's time for the next. Stop any time. 18+ · Terms · Privacy
   > **Email me and save my place** · Not now

   **The switch line is only what the account is for:** "Gets you back in from
   any phone." The required account line of [ADR 0067](0067-every-cadence-nudge-carries-a-stop-link-and-the-sent-card-says-an-account-is-made.md)
   decision 5 ("Makes you an account ... Reminders to plan the next one can be
   stopped from the email") is amended: that an account is made is the switch's
   own label and the button, and the **reminders disclosure moves into the fine
   print**, which is now the recorded consent. "Keep your place for good" has no
   fine print and no consent, so it keeps the longer line
   (`sent.makes_an_account`).

   **The fine print is the consent, and there are two of them**, because the
   card says two different things and the record must say what was shown
   ([ADR 0019](0019-consent-is-recorded-when-it-is-given.md), [ADR 0048](0048-the-consent-sentence-is-the-one-string-that-lives-in-config.md)):

   | Shown when | Version | Words |
   | --- | --- | --- |
   | The switch is on; or there is no switch because the person already has an account | `2026-10-24` (`CONSENT`) | Emails about this meetup, plus a nudge when it's time for the next. Stop any time. |
   | The switch is off (no account is made) | `2026-10-24-no-account` (`CONSENT_NO_ACCOUNT`) | Emails about this meetup. Stop any time. |

   The nudge is promised only where it can come: it goes to an account holder
   (ADR 0067), so the switch-off sentence does not mention it. "Emails about this
   meetup" is every plan letter in one phrase (locked in, changed, moved, called
   off, needs your times again, the reminder and the question after), each of
   which carries a stop link; `CONSENT.covers` maps every one to it and a test
   holds the list to `SUBSCRIBER_KINDS`. The client sends the version of the
   sentence it rendered (`consentFor(account)`), including from a resend on
   Check your email, and the server accepts both. Both stay on
   `CONSENT_VERSIONS`; the three earlier versions are untouched.

   **18+ and the links sit on the fine print line**, small: "18+ · Terms ·
   Privacy", with Terms and Privacy as links, where an account is made. With the
   switch off there is no 18+ and no links, as before. Switch off: "Your place
   stays on this phone." and the button **Email me about this meetup**.

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
- **Keep `2026-10-06` and trim only the notice.** Rejected by the founder ("new
  consent"): the fine print was the longest thing left, and it is the recorded
  sentence, so shortening it is a new version.
- **One sentence for both switch states.** Rejected: with the switch off no
  account is made and no nudge can come, so a sentence that promised one would
  record a consent for something that will not happen.
- **Put the nudge in the switch line.** Rejected: the line is one clause on what
  the account is for; the disclosure belongs in the sentence that is recorded.
- **A new token for the switch's outline.** Not needed: one colour, used once.

## Consequences

- A guest's pick takes two taps. A person who tapped the wrong name loses
  nothing.
- The Sent card is shorter: its switch line is `sent.gets_you_back_in`, its fine
  print is `consentFor(account).text`, and "Keep your place for good" keeps
  `sent.makes_an_account`.
- `CONSENT` moves to `2026-10-24` and `CONSENT_NO_ACCOUNT` is
  `2026-10-24-no-account`. New subscriptions record whichever words were shown;
  existing ones keep the version they agreed to. `CONSENT_VERSIONS` ends with
  the two, in that order, and the test requires them to be its last two
  entries (ADR 0048 said `CONSENT` is the last entry).
- No migration, no new event. `request_email_updates` stores the version as
  text and the Edge Function checks it against `CONSENT_VERSIONS`.
- The canvas artboards for Continue-as, Sent, the name step, the hours sheet and
  the locked-in screens are regenerated from `docs/design/gen.py`.

---
adr: 69
title: "Every letter to an account holder carries a stop link that needs no sign-in"
status: proposed
date: 2026-10-15
amends: [25, 29, 38, 67]
builds_on: [20, 23, 27, 36]
---
# ADR 0069: Every letter to an account holder carries a stop link that needs no sign-in

_Status: proposed · 15 October 2026 · supersedes the part of [ADR 0029](0029-an-organiser-turns-organiser-email-off-in-the-app.md) that kept replies closed outside the organiser-email switch and gave the organiser kinds no stop link; generalises the token and page of [ADR 0067](0067-every-cadence-nudge-carries-a-stop-link-and-the-sent-card-says-an-account-is-made.md); amends [ADR 0025](0025-the-preferences-link-is-minted-with-each-email.md) and [ADR 0038](0038-the-quiet-asks-initiator-is-written-to-at-their-own-address.md); builds on [ADR 0020](0020-the-verification-token-is-minted-by-the-sender.md), [ADR 0023](0023-emailed-tokens-travel-in-the-fragment.md), [ADR 0027](0027-the-organisers-auth-address-is-an-email-contact.md) and [ADR 0036](0036-the-cadence-nudge-is-decided-once-per-cycle.md)_

## Context

SUS-110 (finding H5 of the pre-release audit of 1 October 2026). Plan-update
email has a sound unsubscribe: a footer link on every letter, no sign-in, and a
`List-Unsubscribe` header. Email to an **account holder** (a person whose
confirmed sign-in address is a contact, ADR 0027) had none of that. Five kinds
went to an address with no opt-in, and each could be stopped only from a signed-in
settings screen: the organiser's `options_ready`, `replies_closed` and
`did_it_happen` (ADR 0029), and the quiet ask initiator's `threshold_initiator`
and `quiet_expired` (ADR 0038). A mail client showed no unsubscribe control for
any of them, so the only one-tap way to stop them was "report spam", which
suppresses the address for everything and costs the sending domain.

ADR 0067 (SUS-190) gave the sixth, the cadence nudge `about_time`, a stop link
and left the rest to this ticket. On 15 October 2026 the founder chose the
widest of the three options: **all of them.** Every account-holder letter gets a
stop link that needs no sign-in and a `List-Unsubscribe` header pointing at it.

## Decision

**1. Three families, one mechanism.** The letters an account holder gets without
opting in fall into three families, and each family has its own stop:

| Family | Kinds | Token purpose | Link | What it writes |
| --- | --- | --- | --- | --- |
| nudges | `about_time` | `nudge_stop` (ADR 0067) | `/n#<token>` | `circle_members.muted_nudges`, every active circle |
| organiser | `options_ready`, `replies_closed`, `did_it_happen` | `organiser_stop` | `/o#<token>` | `profiles.muted_organiser_email` |
| quiet | `threshold_initiator`, `quiet_expired` | `quiet_stop` | `/q#<token>` | `circle_members.muted_quiet_asks`, every active circle |

Each writes the flag the settings screen already writes for that family
("Nudges to plan the next one", "Emails about plans you organise", "Quiet asks"),
so settings shows the result and turns it back on. **No new flag was needed:**
the quiet ask's two letters were already stopped by `muted_quiet_asks`
(`QUIET_SENSITIVE_KINDS`, read when the job is written and again when it is
sent), so the quiet family writes that one. The quiet and nudge flags are per
circle, so the tap sets them in every circle the person is an active member of,
for the reason ADR 0067 gave: someone who asks for these letters to stop has not
asked for them to stop in one circle only.

**2. One purpose per family, so a token stops only its own family.**
`email_action_tokens.purpose` gains `organiser_stop` and `quiet_stop` beside
`nudge_stop`. `public.issue_stop_token(contact, purpose, digest)` replaces
`issue_nudge_stop_token` and mints any of the three, for a verified contact that
belongs to a user; it refuses every other purpose. `public.stop_letters(digest,
family)` replaces `stop_nudges`: it takes the family the page was opened for and
accepts a token only if its purpose is that family's. A tampered, expired,
unknown, other-family, other-purpose or other-person token gets the same
`link_expired`, so the endpoint does not say which tokens exist. A token for one
family never writes another's flag, never touches plan-update email, and never
reaches another person: it names a contact, and the contact names the one
account. Like ADR 0067's it is minted per letter at send time (ADR 0020), stored
as a digest, reusable and valid for a year, and not consumed by the tap. The
token is in no log and no event.

**3. One page, told the family by its path.** `/n`, `/o` and `/q` render the
same page (`StopLettersFlow`). The path is not a secret; it says only which kind
of letter, and the token stays in the fragment (ADR 0023). **Opening the link
does nothing**: the page shows what the tap stops and one button, and only the
tap posts the token to the `stop-letters` Edge Function, so a mail gateway or a
link scanner that opens the link, even one that runs the page's script, stops
nothing. The page says plainly what it stops and that settings turns it back on:

- `/n`: "Stop these reminders" (unchanged from ADR 0067).
- `/o`: "Stop emails about plans you organise", naming options ready, replies
  closed with nothing locked in, and the question the morning after.
- `/q`: "Stop emails about quiet asks", saying that it also turns quiet asks off
  for the person in every circle, which is what that setting does: they will not
  be asked about other people's, and cannot start one until they turn it back
  on.

A repeat tap is harmless (each update touches only rows still unmuted), and the
answer is `{ "stopped": true }` with no name, circle or address. The function
keeps ADR 0067's behaviour and was renamed `stop-letters` because it is no
longer about nudges alone; it is the same function, with a `family` in its
request.

**4. Every one of these letters carries the link and the header.** The footer
shows "Not for you?" (nudge) or "Don't want these?" (organiser, quiet) and the
family's label, above the settings line where there is one, and
`List-Unsubscribe` is the same URL. `STOP_LINK_KINDS` in the email types is the
one table of kinds and families; a render test fails if an email kind is neither
a plan update, the verification letter, nor in it. There is no
`List-Unsubscribe-Post`, for ADR 0025's reason: a one-click POST goes to the URL
itself, and the token would then sit in a request log. **A letter whose contact
cannot be given a token** (it is not verified, or belongs to nobody) **is
skipped, not sent without one** (`contact_unverified`), the rule of ADR 0067.

**5. Replies closed is inside the organiser switch.** ADR 0029 §2 kept
`replies_closed` outside "Emails about plans you organise" because it is the one
message saying a plan other people answered now waits on the organiser alone. A
stop link that does not stop the letter it is under is not one, and the founder's
decision covers `replies_closed`, so `organiserEmailSwitch` is now true for it
and the settings row says so. The cost is the one ADR 0029 named: an organiser
who stops these letters may leave a plan to lapse with everyone's answers in it.
They chose that, the plan page still shows the replies-closed screen when they
next open it, and the circle's own mute ("Everything from Sunday Crew") already
stopped it. The owner's fallback on a quiet plan nobody took on is the same kind
and is stopped the same way, by the owner's own switch.

**6. The words about email are updated.** `/privacy` and the in-app Privacy
screen now say that the letters about plans you organise and quiet asks you
start each have a link to stop that kind of letter without signing in, and that
settings turns them back on. The sentences about the nudge and plan updates
(SUS-189, SUS-190) are unchanged.

## Alternatives considered

- **Only the cadence nudge** (the second option on the ticket). Already done by
  ADR 0067. The organiser and quiet letters would still have had no stop but a
  sign-in, and no header.
- **Leave it, on counsel's advice that all six are transactional.** Not the
  founder's choice; and a header that points somewhere is cheaper than relying on
  the classification.
- **One token purpose for everything.** One link would then stop all three
  families, so a tap under a quiet ask's letter would also turn off the
  organiser's mail and the nudge. Rejected: a token must stop only what its link
  says.
- **A new flag for the quiet ask's letters.** Not needed: `muted_quiet_asks`
  already stops exactly those two letters (and the push prompts and starting an
  ask, which the page says). A narrower flag would have made the settings row
  and the link disagree about whether quiet asks are on.
- **Stop in the one circle the letter is about.** Rejected, as in ADR 0067.
- **Keep `replies_closed` exempt and give it a link that stops nothing.**
  Rejected: that is a footer that lies.
- **Add `/n2`, or three Edge Functions.** Rejected: one page and one function,
  with the family in the request, is the smaller surface.

## Consequences

- Migration `0053`: the two purposes, `issue_stop_token` and `stop_letters`
  (replacing `issue_nudge_stop_token` and `stop_nudges`, which are dropped), and
  the `stop-letters` function (config block renamed from `stop-nudges`). pgTAP
  `460_letter_stop_links.sql` covers grants, scope, every refusal and a repeat,
  per family. Links already sent under ADR 0067 keep working: `nudge_stop` tokens
  are accepted as the `nudges` family.
- ADR 0025's "organiser letters carry no stop link" is no longer true for any
  kind; ADR 0029's decision to stop them in the app stands, and its sentence that
  `replies_closed` still sends does not. ADR 0038's two quiet letters carry a stop
  link, though neither is a subscription. ADR 0067's page, token and function are
  now the three-family mechanism above.
- Spec §5.8 (organiser email, quiet-ask initiator email) and §9 (edge cases) say
  how each letter is stopped; the architecture's function table and
  the Emails and stop-page artboards follow.
- A person who stops quiet asks from the link also cannot start one until they
  turn it back on in notification settings. That is what the existing switch
  means, and the page says it before the tap.
- A tap changes a setting without a sign-in, so the page reveals nothing about
  the account and the answer is the same for every refusal.

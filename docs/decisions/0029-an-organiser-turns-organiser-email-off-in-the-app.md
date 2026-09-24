# ADR 0029: An organiser turns organiser email off in the app, not by a link

_Status: accepted · 24 September 2026 · answers the question ADR 0025 left open_

## Context

A signed-in organiser with no app receives four kinds by email (spec §5.8,
review C6): **options ready**, **replies closed with no decision**, **did it
happen**, and the **about-time** nudge. ADR 0027 made their confirmed auth
address an ordinary `private.email_contacts` row so those letters can be
written, suppressed and bounced like any other.

None of them can be stopped. ADR 0025 gave them no stop link on purpose: the
two footer links on a plan-update email open `/e#<token>`, and a preferences
token is scoped to a plan-update _subscription_ — the record of a guest
consenting to hear about one plan — which an organiser does not have. `/e`
would list nothing that stops the letter the link came from. ADR 0025 left the
question to the founder, and on 20 September 2026 the founder answered it:
**an organiser turns these off in the app, where they are already signed in**.
No token is minted for it and no page works without a session.

That leaves four things to settle, and SUS-83's own comments already constrain
two of them:

- **Gate eligibility, not the channel.** `channelFor` prefers push and falls
  back to email. Removing a person from the audience would also stop the push
  version once SUS-59 lands, which is not what "organiser emails" says.
- **Never delete the contact, and never suppress it.** The organiser's contact
  is long-lived by design (ADR 0027's consequences): retention keeps it, and a
  suppression is spec §9's "no automatic reactivation" — it would also refuse
  every future plan-update subscription at that address. A flag the domain
  reads is the only shape that does not fight either.

## Decision

### 1. What the switch covers: one switch, for the organiser's working email

**One switch, "Emails about plans you organise", stops the email version of
`options_ready` and `did_it_happen`.** It does not touch push, member email, or
anything a subscription governs.

The four kinds are two different things, as the ticket says. `options_ready`
and `did_it_happen` are the working mail of a plan the organiser started: one
says the plan could be decided early, the other asks for a report after it
happened. They are the same kind of message to the same person for the same
reason, and a person who does not want one does not want the other. Two
switches for them would be two questions with one answer.

`about_time` is the other kind — a prompt about a circle the person may have
stopped caring about — and it **already has its switch**: "Nudges to plan the
next one" (`circle_members.muted_nudges`, SUS-39), per circle, on every
channel. Caring about a circle is a per-circle fact, so that is the right place
for it, and giving the same letter a second, global switch would make the
screen answer one question twice with a chance of two answers. The
organiser-email switch leaves `about_time` alone. The nudge's recipient is not
necessarily an organiser, either; its footer already says "because you're in"
the circle.

### 2. Whether anything is unstoppable: `replies_closed` still sends

**`replies_closed` is outside the switch.** It is sent once when replies close
and nothing is locked in (spec §5.7), and it is the only message that says a
plan other people have answered is now waiting on the organiser alone: lock in
the top option, hand it on, or give it a day. If it does not arrive, the plan
lapses with everyone's answers in it, and the people who pay for that are the
five who answered, not the one who turned email off.

It is bounded: one per plan revision, only when the organiser has not already
decided, and quiet hours still apply. The screen's row says in its detail line
that this one still comes, and its footer says why it came, so neither the
switch nor the letter pretends otherwise.

The circle's own switch ("Everything from Sunday Crew") still stops it,
because that switch says _everything_ and `isMuted` has read it that way since
S1-06. A person who has muted a whole circle has
told us something stronger than "no organiser email", and overriding it here
would make that switch the one that lies.

### 3. Where it lives: per person, on `profiles`

**`public.profiles.muted_organiser_email boolean not null default false`**, the
person's own row, updatable only by them through a column grant, as
`display_name` and `time_zone` already are.

These letters go to an identity's own address and follow it across every
circle it organises in. Per circle would put the choice on a membership the
letter is not really about, and would ask the same question once per circle for
an answer that does not vary by circle. `private.email_subscriptions` is the
wrong table: its `scope` is `plan_updates`, every row needs a plan, and it is
guest consent, which this is not.

`recipientsFor` reads it through a new, **required** `EligibilityContext` field,
`mutedOrganiserEmail`, in `mayEmail` — the email-channel test — so the person
drops out only when email was the channel they would have had. Required rather
than optional because an absent value would default to _send_: a caller that
forgot it would silently ignore the person's choice, and a default that fails
open is not a rule. Which kinds it stops is a column on the kinds table
(`organiserEmailSwitch`), not a list in the dispatcher.

The dispatcher asks twice, for the reason it asks about consent twice: at
enqueue (`dispatch_context` carries the flag) and at send (`dispatch_claim_due`
does). `did_it_happen` is written when the meetup is confirmed and sent the
next morning; a switch that did not reach what was already queued would stop
nothing for days.

### 4. What the letter says instead of a stop link: where the setting is

**`options_ready` and `did_it_happen` keep their "why" sentence and gain a
"where": a link to `/settings/notifications`**, the route the switch is on. It
carries no token and needs none: the reader is an organiser, so they have an
account and sign in with it. A reader who is signed out is sent to sign-in and
then back to the switch: `/settings/notifications` joins the short list of
paths sign-in may return to (`safeReturnPath`), as an exact string, so it
opens no redirect.

`about_time` gains the same pointer. The switch that stops it — "Nudges to plan
the next one" — is on the same screen, so the link is as true for it as for the
other two.

`replies_closed` keeps its "why" and adds that it is sent even with organiser
emails off, because the plan is waiting on them. It carries no settings link,
because no setting on that screen would stop it short of muting the circle.

No footer mentions installing the app (the Emails artboard's "operational
only").

## Alternatives considered

- **A stop link on organiser email that needs no sign-in**, like `/e`. Rejected
  by the founder's decision and for the reasons in ADR 0025: a new token kind,
  minted per letter, for a person who already has an account.
- **One switch for all four kinds, nothing exempt.** Simpler to say, and it is
  the shape that lets one person's inbox preference expire a plan five other
  people answered. Rejected for `replies_closed`; `about_time` is excluded for
  the separate reason that it already has a switch.
- **Separate switches per kind.** Four rows for four letters, three of which
  most people will never tell apart. Rejected: the difference that matters
  (working mail versus a circle prompt) is already expressed by which switch
  governs which kind.
- **Per circle, beside the mutes on `circle_members`.** Matches the existing
  cards, and asks the same question once per circle. Rejected: the letter is
  addressed to a person, and the circle-shaped choice already exists as
  "Everything from {circle}".
- **A new `private.email_subscriptions` scope with a nullable plan.** Reuses a
  table whose every reader assumes a plan and a guest's consent. Rejected.
- **Suppress, or delete, the organiser's contact.** Rejected by ADR 0027:
  suppression is permanent and address-wide, and deletion takes queued jobs and
  suppression history with it.

## Consequences

- Spec §5.8's organiser-email paragraph gains a sentence saying how an
  organiser stops it, and which one still comes.
- ADR 0025's open question ("How an organiser stops organiser email is still
  open") is answered here. Its decision that organiser email carries no stop
  link stands: what it carries instead is a pointer to the setting.
- An organiser who turns the switch off and has not installed the app hears
  about options only from the circle and the plan page, and does not get the
  morning-after question. A meetup nobody reports leaves `last_met_at` where it
  was, so the next cadence nudge may come early. That is the choice they made,
  and the plan page still offers the report.
- S2-04 (SUS-52), which sends `about_time`, must read `muted_nudges`: that
  switch, not this one, is what stops the nudge. The domain's `Member` does not
  carry it yet.
- When push lands (SUS-59), the switch still governs email only. Push has its
  own settings (Slice 3), and an organiser with a device is pushed, not emailed,
  so the switch simply stops mattering to them.
- The settings link is a plain path, `/settings/notifications`, built by
  `notificationSettingsUrl` in `@circles/contracts` beside the other emailed
  links. It carries nothing about the reader, so it is not a capability and not
  a fragment link.

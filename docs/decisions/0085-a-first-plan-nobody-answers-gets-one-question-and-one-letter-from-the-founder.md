---
adr: 85
title: "A first plan nobody answers gets one question and one letter from the founder, a support letter capped at one per circle"
status: accepted
date: 2026-10-20
builds_on: [29, 61, 69, 84]
---
# ADR 0085: A first plan nobody answers gets one question and one letter from the founder, a support letter capped at one per circle

_Status: accepted · 20 October 2026 · builds on [ADR 0029](0029-an-organiser-turns-organiser-email-off-in-the-app.md), whose switch it sits under, [ADR 0061](0061-the-chasing-survey-never-holds-lock-it-in.md), whose "an optional question never gates anything" it applies to the waiting screen, [ADR 0069](0069-every-account-holder-letter-carries-a-stop-link-that-needs-no-sign-in.md), whose stop link it carries, and [ADR 0084](0084-a-campaign-tag-labels-a-circles-cohort-row-never-a-person.md), whose stalled-first-plans reading it acts on. Changes spec §5.8 and §11.3_

## Context

[ADR 0084](0084-a-campaign-tag-labels-a-circles-cohort-row-never-a-person.md)
made a stranger's stalled first plan visible to the founder as counts and ages.
It cannot say **why** a first plan stopped, and a stranger who stalls there is
the one person the product has no other way to reach. Two small things help,
and both are about the organiser of a circle's first plan, 48 hours after it was
made, when nobody but them has answered:

- a single optional question on their own waiting screen, so the founder can
  tell "never posted the link" (a copy and confidence problem) from "posted,
  nobody replied" (the group, not the product);
- a single plain letter from the founder offering a hand, whose replies are the
  conversations that could not otherwise be had.

The second is a message the product sends on its own account, which is the line
the spec draws hard: "nothing about activity, streaks or news, ever" (§5.8) and
product-marketing email is out of the MVP (§18). The record has to say why this
letter is on the right side of that line, and what stops it drifting across.

## Decision

**The question.** On the organiser's waiting screen for a circle's **first**
named plan, once the plan is 48 hours old and nobody but the organiser has
answered it, one optional question is shown: "Nothing in yet. What's happened?",
with three answers (*I haven't posted the link yet*, *I posted it, no one's
replied*, *This isn't the right group for it*) and Skip. It is in the shape of
[ADR 0061](0061-the-chasing-survey-never-holds-lock-it-in.md): it gates nothing,
has no free text, and an unanswered question is simply not answered. A tap
records `first_plan_stalled(answer)` with the word and nothing else; Skip
records no event. "Never repeats" is state: a `nudge_states` row for a new
moment, `first_plan_stalled`, once per plan, which says the question was shown
and nothing about the answer. It is never shown to a guest or a member, who do
not reach the organiser's screen. It changes nothing about the plan.

**The 48 hours** are counted from when the plan was made, by one function in the
domain (`firstPlanQuiet`) that the screen, the letter's sweep and their tests
share. A plan counts if it is the circle's first named plan, is still asking
(collecting or ready), and has had no answer from anyone but its organiser on
any revision. (The founder's stalled view counts from the first sign the plan
was shared, because it reads events anyway; the screen and the letter use the
one fact the database always has, so a lost event cannot hold either back.)

**The letter.** At the same moment, one letter goes to the organiser:
"Nothing's come in on your {circle} plan yet. If something's in the way, reply
to this and I'll help you sort it." It is **a support letter under the
organiser-letters consent, not product marketing.** It is a person writing to
the one person who started something, about that thing, offering help they can
take up by replying; it sells nothing, mentions no feature and no app, names no
one but the circle, and carries no plan code. It is therefore the same kind of
letter as options ready or replies closed, and is held to the same rules:

- It is a new notification kind, `first_plan_quiet`, under **Emails about plans
  you organise** ([ADR 0029](0029-an-organiser-turns-organiser-email-off-in-the-app.md)):
  off means it is not written, and a letter already held is skipped.
- It carries the stop link (`/o#<token>`, no sign-in) and `List-Unsubscribe`
  ([ADR 0069](0069-every-account-holder-letter-carries-a-stop-link-that-needs-no-sign-in.md)),
  and the footer says where the switch is. A letter that cannot be given the
  link is not sent.
- It goes through the existing dispatcher, so quiet hours (9 pm to 8 am, in the
  recipient's zone) hold it and the usual send-time checks apply. It is
  re-checked when it is sent: if anyone else has answered, the plan has ended or
  been handed to someone else, it is skipped.
- It is plain text in a person's voice: no lockup, no card, no button. The From
  line shows the founder's first name (`brand.founderName`) over the product's
  authenticated sender address, and replies go to the support address
  (`brand.supportEmail`), which the founder reads.

**The cap: one per circle, ever.** The jobs table's idempotency key is per
recipient, plan and revision, so it cannot hold the cap (a second plan has a key
of its own), and the table is cleaned after thirty days. The cap is its own row,
`private.first_plan_quiet_letters`, one per circle, written in the same
transaction as the job under the circle's lock. The row is written even when
there is nothing to send (organiser letters off, no address we may write to), so
a letter nobody wanted at 48 hours is not sent at 60 because a switch was turned
back on. A second stalled plan in the same circle sends nothing. There is no
repeat, no reminder, and no sibling letter at 7 days or any other mark; a change
to any of that is a new decision.

## Alternatives considered

- **Asking in the app only.** Costs nothing and cannot be stopped, but the
  organiser who never posted the link is exactly the one who is not opening the
  app, and a question cannot be replied to.
- **A letter sent from the product's name with a button.** It would read as an
  engagement nudge, and the spec's line is that nothing the product sends is
  about activity. A person's name, two sentences and "reply to this" is a
  different thing, and it is the only shape that can be defended as support.
- **Counting the cap in the jobs table.** Per-plan keys cannot express it and
  retention deletes the evidence.
- **Counting 48 hours from the share.** It needs an event, which can be lost;
  the plan's own creation time cannot.
- **Sending the letter whatever the organiser-letters switch says.** It would be
  a product message outside every consent the organiser gave.
- **Free text on the question.** A field to type a reason into is a place for a
  name or an address to land in an event (non-negotiable 8). Three words and
  Skip keep the answer countable.

## Consequences

- A migration: the new nudge moment, the new job kind, the cap table, two
  service-role functions (the sweep's candidates and the decision) and
  `stop_letters` skipping a queued `first_plan_quiet` on the organiser stop.
- `brand` gains `founderName`, the first name a personal letter is signed with,
  and `RenderedEmail` an optional `fromName`.
- The founder gets the replies as conversations, and the `first_plan_stalled`
  split beside the stalled-first-plans table. A reply is logged as a feedback
  row by hand; nothing reads the mailbox.
- The letter's From address is the product's authenticated sender (the mail
  subdomain's), not the support address, because that is the domain with SPF and
  DKIM. The reply goes to the support address.
- A circle whose organiser has no confirmed address, or has organiser letters
  off at 48 hours, never gets the letter.

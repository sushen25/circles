---
adr: 91
title: "Circle home offers one way into the chat at a time, and any member can add someone"
status: accepted
date: 2026-10-23
amends: [22, 28]
builds_on: [26, 49, 73]
---
# ADR 0091: Circle home offers one way into the chat at a time, and any member can add someone

_Status: accepted · 23 October 2026 · amends [ADR 0028](0028-an-invite-secret-is-derived-so-its-owner-can-see-it-again.md) (who may ask for the secret) and [ADR 0022](0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md) (what a visitor is told)_

## Context

A circle has three links, and circle home put two of them side by side. While a
plan was asking, the owner saw **Share the link** on the plan card and **Invite
link** under the members. Both put a link into the same chat, and neither said
what a friend could do with it. The founder, on 22 October 2026: people are
confused between the "plan link" and the "invite link".

The confusion had four roots:

1. **One noun, two jobs, side by side.** Both buttons were "the link".
2. **The invite was redundant exactly when it was shown.** The plan's link
   already lets new people in while the plan is asking ([ADR 0022](0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)),
   so offering the invite beside it suggested the plan link was not enough.
3. **"Link" was on every action:** Share the link, Share, Share again, Invite
   link, Share invite link, Copy link, Reset link. A guest who could not get in
   was told to ask for "the circle's invite link", one they had never seen.
4. **The invite led where it should follow.** Settings opened with a reset, and
   a circle of one led with the invite, though [ADR 0026](0026-first-run-shares-a-plan-and-a-defaulted-quorum-follows-the-circle.md)
   had moved the first run away from it because it is the weaker way to start.

The invite was also the owner's alone: `get-invite-link` refused everybody else
([ADR 0028](0028-an-invite-secret-is-derived-so-its-owner-can-see-it-again.md)).
So a member who wanted to bring a friend between plans could do nothing.

## Decision

### 1. Circle home offers one way into the chat at a time

| Circle state | The way into the chat | Add someone |
| --- | --- | --- |
| Finding a time (a plan takes answers) | **Share the plan**, with "Anyone new can join from it too." | not shown |
| Replies closed, not locked in | none on the card; the organiser's primary is **Pick a time** | shown |
| Locked in | **Send the details**, with "For people already in Sunday Crew." | shown |
| About time, or between catch-ups | none | shown |
| Just you, or new people joined | **Plan a catch-up** is the primary | shown |

While a plan takes answers, **Share the plan** is the way in; otherwise it is
**Add someone**. A locked-in plan's link turns newcomers away, which is why its
card says who it is for. A circle of one leads with planning, because the plan
is how friends join. Spec §5.2's "every state shows … members and the invite
link" changes accordingly.

"Takes answers" is the domain's `acceptsAnswers`: a state of `collecting` or
`ready` with a deadline still ahead. The domain also decides what leads once
replies have closed (`circleHomePrimary`) and where Add someone is offered
(`offersAddSomeone`); no screen works either out.

### 2. Any active member can add someone; only the owner can cancel old invitations

`get-invite-link` answers **every active member of the circle**, guests
included, and refuses anybody else with `not_a_member` (`public.live_invite`,
migration 0076). Resetting stays the owner's: `rotate-invite` and
`issue_invite` are unchanged, because a reset cuts off every invitation already
sitting in a chat.

This is the founder's decision of 23 October 2026: any active member, guests
included, can add someone; resetting stays the owner's.

It changes who can share the secret again, not who can see it. The secret is in
the message a member pastes into the group chat, so it already reaches everyone
in that chat who can read it, and every member can already read the chat the
owner pasted it into. A removed member, a member of another circle and a person
who never belonged are refused, and pgTAP proves each.

### 3. No button is named "link"; refusals say whom to ask

The word "link" names no button. It stays in the share fallback ("Copy",
"Copied") and in "This link isn't active any more". What Add someone sends is an
**invitation**; the reset is **Cancel old invitations**, and the sheet that asks
first says that plans already shared keep working, because only invitations
stop.

A plan that is live but not admitting tells the visitor to ask somebody in the
circle: "This plan isn't taking new answers. Ask someone in Sunday Crew to add
you." A circle's own page tells a non-member to ask someone in it. The dead-link
refusal keeps the single answer [ADR 0049](0049-continue-as-resolves-a-code-only-while-it-is-live.md)
gives it, in new words: "This link isn't active any more. Ask whoever shared it
for a new one." Nobody, guest or account, is told to ask for an invite link.

### 4. The invitation's message is rewritten for adding someone between plans

`shareMessages.invite_to_circle` said "Made a Sunday Crew circle so we stop
losing catch-ups in the chat", which is untrue of a circle a member is adding a
friend to. It now reads "Join Sunday Crew on Wenna so you're in on the next
catch-up. No app needed: {link}". The product's name comes from `brand`, never a
literal, and the domain's template takes it as an argument.

## Alternatives considered

- **Keep both links, rename them.** "Plan link" and "invite link" explain
  nothing a friend can act on, and the plan card would still carry two ways to
  do one job.
- **Remove the invite entirely; the plan is the only way in.** A circle between
  plans, or one whose plan has locked in, would have no way to add a person at
  all. The invitation is the only thing that admits somebody then.
- **Keep it the owner's.** The owner is not always the person who knows the
  friend. The secret already travels in the chat; withholding the button does not
  withhold the secret.
- **Let any member reset it too.** A reset cuts off invitations already sent.
  One member should not be able to do that to the rest.

## Consequences

- Circle home has one way into the chat in every state, and its label says what
  a friend can do with it.
- `live_invite` takes the caller's membership, not the owner's, as its test.
  Migration 0076 and pgTAP 200 and 480 prove the allow and the deny.
- A member's settings gains **Add someone** and loses nothing; **Cancel old
  invitations** is drawn for the owner alone, and `rotate-invite` still refuses
  everyone else.
- The Add someone screen shows the invitation as a message bubble (the
  component the first run's share screen uses), with **Share** and **Copy**,
  and nothing about resets.
- Last caught up and next one are shown only once the circle has met.
- A guest who arrives on a plan that is not taking answers is told whom to ask,
  not about a link they have not seen. This lands with SUS-245, which removes
  the other path to "ask for the invite link".
- Analytics: no new events. `share_opened` already carries the kind (plan,
  locked in, invite).

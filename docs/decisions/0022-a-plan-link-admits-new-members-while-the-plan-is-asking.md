# ADR 0022: A plan link admits new members while the plan is taking answers

_Status: accepted · Date: 17 September 2026_

## Context

Until now one thing could create a membership: the circle's invite secret, carried
in the fragment of `/join#<secret>` and redeemed by `redeem-invite`. A plan link
(`/j/<code>`, `/p/<code>`) carried no way in. S1-24 built the screens to match:
somebody who opens a plan link without a membership is shown "Which one is you?",
and **I'm new here** tells them to ask whoever shared it for the invite link.

The founder tried it on 17 September and called it wrong, and the rest of the
product agrees with him:

- The message an organiser pastes into the group chat (`newPlanMessage`) contains
  **only the plan link**. It is the link the chat actually sees.
- The first-time organiser flow (§5.1) offers "Skip for now, I'll plan first",
  so for many groups the plan link is the only link there will ever be.
- §4.4 already says a guest starts by "tapping an invite **or plan** link", and
  §6.2's journey is a friend tapping the link in WhatsApp, giving a name and
  painting times. From a plan link that journey dead-ended.

Three further things were undecided and surfaced at the same time: what each
kind of visitor should be asked on arrival, what somebody with an account and no
session on this device should do, and whether joining through a plan's link makes
you somebody that plan is asking (`replace_response` answers `not_a_participant`
to a member the plan was never addressed to, and nothing implemented §9's "new
members may opt into the active plan").

## Decision

### 1. The plan's short code admits new members, while the plan is taking answers

Anybody holding a plan link can join that plan's circle as a guest, by giving a
display name. The code in the link is what authorises it. Nothing is added to the
link and the share messages do not change, so links already pasted keep working.

**Only while the plan is taking answers**: the domain's `acceptsAnswers`, which
is a state of `collecting` or `ready` **and** a response deadline still ahead —
the same two conditions `replace_response` checks. A quiet ask still `seeking`, a
confirmed plan, and a completed, expired or cancelled one admit nobody. The
refusal is the single `invite_inactive` answer an unknown code gets: **the join
says no, and never says why.**

That is a promise about the join and nothing wider. Somebody holding a plan's
code can already learn that its circle exists — `preview_for_code` gives the
circle's name for any plan code (ADR 0021), and the Continue-as list answers
for any plan code — and this decision does not change either. What it must not
add is a way to learn a plan's *state*, or that it is a quiet ask, from how the
door is refused.

Both `/j/<code>` and `/p/<code>` admit. They are one code and one plan, seen from
two pages.

Joining stays immediate, as §5.2 already says: no approval step. The owner's
controls are the ones joining by invite has — the "X joined" notice, Remove, and
the cap of twenty (ADR 0012).

### 2. Joining through a plan's link makes you a participant of that plan

The join also adds the person to the plan's current revision, in the same
transaction. They tapped that plan's link; there is no other plan they could have
meant, and sending them to a form whose submit is refused is the failure this ADR
exists to remove. The same call serves an existing member who was never asked: it
adds the participant row and nothing else.

**The quorum does not move.** It was set when the plan was created and changes
only when the organiser adjusts it (ADR 0017). A number that shifted under an
organiser because a stranger tapped a link would be a decision made by nobody.

### 3. What a visitor to a plan link is asked depends on who they are

| Who arrives | What they see |
|---|---|
| A member of the circle, guest or account | The plan. |
| **Signed in with an account, not a member** | One tap: **Join [circle] as [name]**, then the plan. Never a list of names. If their name is taken in this circle, the name step: they pick what this circle calls them, and their profile is untouched. |
| No session, or a guest session with no membership here; the circle **has** guest members | **Which one is you?** — the guests by display name, then **I'm new here** and **I have an account**. |
| The same, and the circle has **no** guest members | Straight to the name step, with **I have an account** beside it. There is nobody to be. |
| **I'm new here** | A display name, then they are a guest member and a participant, on the plan's availability screen. |
| **I have an account** | Sign in, then back to the same link, where they are now one of the first two rows. |
| Anybody who is not a member, and the plan is **not** taking answers | Returning guests can still continue as themselves. Somebody new is told to ask for the circle's invite link. |

One tap rather than none for an account, because joining is visible to everybody
in the circle and opening a link should not be an act with an audience.

**I have an account** exists because saved-place members are never on the
Continue-as list (ADR 0006). Without it, somebody with an account on a new device
taps **I'm new here**, types their own name, and is told it is taken — by their
own membership.

## Alternatives considered

- **The plan link carries the circle's invite secret** (`/j/<code>#<secret>`).
  One capability, and resetting the invite link would still close every door.
  But the secret is stored only as a hash and was shown once, to the owner, so
  an organiser who is not the owner could not compose the message — and nor
  could the owner, the second time. It also changes every share message and
  strands every link already pasted.
- **A per-plan join secret** (`/j/<code>#<planSecret>`). The organiser would
  always have it and it would die with the plan, but it is a second capability
  to mint, store, revoke and explain, for a door this decision already closes on
  a timer.
- **Leave it: only the invite admits.** Coherent, and what was built. It makes
  the first link most friends tap a dead end, in the flow the product's second
  hypothesis depends on.
- **Admit from a confirmed plan too**, so somebody tapping "Locked in" can join
  to see it. Rejected: the door would then stay open for as long as the meetup
  is ahead, and a confirmed plan is not asking anybody anything.
- **Join an account silently on opening the link.** Rejected above: joining has
  an audience.
- **Recompute the quorum when somebody joins.** Rejected above, and it would
  contradict ADR 0017's line between what an organiser decides and what
  happens to them.

## Consequences

- **A plan's short code is now a capability, and a weak one on purpose.** It is
  eight characters from a 31-letter alphabet (about 8.5 × 10¹¹), it sits in the
  URL path — so in server logs, link previews and browser history — and **it
  cannot be revoked.** What bounds it is time: it admits only until the response
  deadline, three days by default, or until the organiser confirms or cancels.
  ADR 0021's reasoning that the prize for guessing a code is a circle's name no
  longer holds while a plan is asking; the prize is a guest seat. The join is
  therefore rate-limited per code and per address, Turnstile-checked on web, and
  needs a signed-in (anonymous) caller, none of which the preview has.
- **Resetting the invite link no longer closes every door**, and until the
  deadline only one thing closes this one: cancelling the plan. §9's "invite
  link leaks: reset" keeps its meaning for the invite. **Removing somebody is
  cleanup, not a lock** — the link still works, so they can join again from a
  fresh browser, exactly as a removed member can through a live invite (§5.2
  keeps removal and resetting as separate tools for that reason). If a way to
  shut a plan link early turns out to be needed in practice, the per-plan secret
  above is the upgrade, and it is compatible with this decision.
- **A plan link pasted into a chat admits everybody in that chat**, including
  people the owner never meant to invite. That is the same exposure the invite
  link has in the same chat; the difference is the remedy, above.
- `join-plan` takes a display name from **anybody**, as `redeem-invite` does:
  required for a guest, optional for an account, which otherwise joins under its
  profile name. It names the membership in this circle, not the person's
  profile.
- **This amends a privacy rule, narrowly and on purpose.** Non-negotiable 8 and
  the invariant in spec §8.2 say no log ever holds a token. A plan's short code
  is in a URL path, so the hosting provider's access logs hold it, and under this
  decision it lets somebody in. Rather than pretend otherwise, the rule now says
  what it means: **a plan's short code is not a token.** Invite secrets,
  re-entry, verification and preference tokens, and session tokens are; they
  stay out of every URL path and every log, with no exception.
  The reasoning for the carve-out: the code was designed to be public (it is
  pasted into group chats and read aloud, `contracts` calls it "not a secret");
  what it admits to is a guest seat that everybody in the circle can see and the
  owner can remove; it admits for days, not for good; and the only logs that
  hold it are the hosting account's own request logs, readable by whoever
  already administers the product. Keeping the rule absolute would mean a
  fragment secret on every plan link — the per-plan secret above — which was
  weighed and declined for now.
- The carve-out is for URLs only. The code still stays out of analytics
  payloads and out of our own function logs, so it is never somewhere it did not
  already have to be.
- Part of §9's "new members may opt into the active plan" is now specified: a
  plan's own link is the opt-in. Somebody who joined through the **invite** while
  a plan was running still arrives unasked; opening that plan's link asks them.
- A new Edge Function and definer function (S1-24c, SUS-79), and the arrival
  logic above in the client (S1-24d, SUS-80). Until those land, the app keeps
  S1-24's behaviour.
- The privacy invariants are unchanged: only active members see or act on a
  plan, and a reattachment still moves a membership only within its circle and
  never onto a saved-place member.

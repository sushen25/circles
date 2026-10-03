# ADR 0049: Continue-as resolves a code only while it is live, and its limits are enforced in SQL

_Status: proposed · 2 October 2026, decision 6 added 3 October 2026 · amends [ADR 0006](0006-continue-as-reattaches-a-guest-membership-without-owner-approval.md) and [ADR 0022](0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md), and spec §5.1_

## Context

[ADR 0006](0006-continue-as-reattaches-a-guest-membership-without-owner-approval.md)
accepted that Continue-as needs no owner approval, on the strength of three
safeguards: only guest memberships can be taken, at most three moves per
membership per seven days, and the owner is told. [ADR 0022](0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)
accepted a short plan code in URLs and logs because it "admits for days, not for
good". The pre-release audit of 1 October 2026 found three places where the
database did more than either record accepted:

1. **A code never stopped working.** `guest_members_for_reattach` matched the
   circle's code or the code of any plan the circle had ever had, whatever the
   plan's state and whatever the circle's status. A link to a cancelled plan, or
   to an archived circle, listed the same people as a live one.
2. **The volume limits could be skipped.** `reattach_member` is granted to
   `authenticated`, which includes any anonymous session. The per-address and
   per-circle limits lived only in the `reattach-member` Edge Function, so a
   client that called the RPC directly met none of them.
3. **The cap could be spent against the member.** "Three per membership per
   seven days" counted every move, in both directions and by either path. Three
   moves made by somebody else exhaust it, and the member, including one holding
   a valid emailed re-entry link, is then refused for a week. The only remedy was
   removing the membership, which deletes that person's answers.

The founder decided on 2 October 2026: Continue-as resolves a **circle code**
only while the circle is `active`; a **plan code** only while the plan is
`collecting` or `ready`, or `confirmed` until N days after the meetup, and the
circle is `active`; never for a cancelled or expired plan or an archived circle,
which send the person to the existing "this link isn't active" screen. This ADR
proposes N, chooses the cap's design, and decides whether the list hands back an
opaque handle instead of a user id.

## Decision

**1. One rule, in one function.** `private.circles_open_to_continue_as(code)`
returns the circle a code may still be used in, or nothing:

| Code | Resolves while |
|---|---|
| a circle's | the circle is `active` |
| a plan's | the circle is `active`, and the plan is `collecting` or `ready`; or `confirmed` or `completed` and its meetup **ended** less than `private.continue_as_window()` ago |
| anything else (cancelled, expired, `draft`, `seeking`, an archived circle, an unknown code) | never; the answer is the same empty one |

`guest_members_for_reattach` reads it, and so does `preview_for_code`, so that
what the screen calls "not active" and what the list refuses are one decision:
a plan link that is no longer live draws the generic link-preview card, and the
Continue-as screen, which asks `preview_for_code` for its title, reads that null
as "this link isn't active" and shows the existing screen instead of a name
step that could join nobody. `draft` and `seeking` are excluded because neither
is ever shared by link (a quiet ask is never shared, §5.4); `join_from_plan`
already refuses both.

**2. N is fourteen days, measured from the meetup's end; `completed` counts as
`confirmed`.** (Proposed here; the founder approved fourteen on 2 October 2026, and the same day decided in chat that `completed` takes the same window as `confirmed`.) What has to keep working inside N:

- The morning-after letter is sent at nine the next morning, in the reader's
  zone (`morningAfter`), and its buttons open the plan's link. A guest who lost
  their session between the meetup and the letter arrives at Continue-as.
- `report_outcome` and `attendance` have no deadline. Both are accepted from the
  moment the meetup ends, for as long as the confirmation is `active` (and, for
  attendance, `completed`). A late answer is ordinary: `lastMetAtAfter` is
  written for exactly that case.
- The moment the organiser answers "did it happen?" the plan becomes
  `completed`. If `completed` were outside the rule, the people who tap "I was
  there" after the organiser had answered would be shut out the same day, so it
  takes the same window. `completed` after a `cancelled` outcome has no live
  confirmation and so is never in the window.
- ADR 0006's reason for the whole feature is Safari dropping script-writable
  storage after seven idle days. A guest who opens the old chat link a week
  later, on the same phone, is the commonest case there is.

Seven days would cut off exactly that guest on the last day; thirty keeps a
forwarded screenshot working for a month for no use the morning-after needs.
Fourteen covers the letter, a week's lateness, and a second week of slack for
the storage cap. After N the plan's link is not somebody's way back: a person
who gave an address still has the re-entry link in every letter (it does not
depend on the plan's state), and anybody else is sent to the circle's invite.
The number is one function, `continue_as_window()`; changing it is a new
migration, not a rewrite.

**3. The limits are in SQL.** `reattach_member` now refuses unless the circle is
`active` (answering `member_not_found`, the same answer as a membership that is
not there, so it says nothing about which), and counts the list path per circle
with `take_rate_token` (`reattach_circle_sql`, twenty an hour, a fixed hourly bucket like every other `take_rate_token` limit, so up to forty can land across a boundary). The Edge
Function's counters stay as the outer limit and use different scopes, so neither
spends the other's budget. A refusal raises, and raising rolls its count back, so
the counter bounds **completed** moves, which is what hurts anybody. That is the
same property the roster lookup's limit has had since S1-13, and it is the
reason there is no per-caller counter here: a caller who completes a move is
then a member of that circle and cannot complete another in it, so a per-caller
limit could only ever count failures, which are rolled back. The roster
lookup keeps its thirty-an-hour limit per caller.

**4. The cap does not count, or refuse, a move made with a valid emailed link.**
The founder decided this in chat on 2 October 2026, after reading the analysis and
the residuals below. Of the two options the ticket offered:

- *Do not count a move made with a valid re-entry token.* Chosen. The cap exists
  to stop a name being passed around by people who prove nothing. A re-entry link
  proves control of an address the membership holds; it is single-use, valid for
  seven days, and rate-limited per token in the Edge Function. Only the moves made
  by picking a name from the list are counted (`private.list_moves_this_week`), and
  a move made with a link is never refused by the cap, so **whatever has happened
  to the place, a member with a valid emailed link can take it back**, including
  from the fifth move in a chain. The audit row records `source` (`list` or
  `email`); the walk along the chain crosses every move and charges only the
  list's. Rows written without a `source` count: the stricter reading, for a
  window that closes in seven days.
- *Count moves away from an identity instead.* Rejected. Every move away from
  an identity is a move into another, so it counts the same moves by a different
  name, and the member's return is still one of them. It does not remove the
  attack; it moves it.
- *Exempt only links for an address that was on the place first.* Tried and
  dropped. Contacts travel with a membership, so no field the database holds says
  when an address reached a place: `verified_at` says when it was proved anywhere,
  merging contacts changes it, and a member who legitimately adds an address after
  an earlier return has no "first" to be before. Two review rounds found a way
  round it and a way for it to refuse the real member.

What this does **not** do, said plainly:

- **A taker with a mailbox of their own can keep trading the place.** Contacts
  travel with a membership, so whoever holds a place can verify an address and be
  sent links for it, and a move made with one is not counted. The earlier claim
  that a link "cannot be minted by anybody who is not already the member" was
  wrong and is withdrawn. What bounds it: a link is minted by the letters the
  product sends, one per address per letter and valid seven days, which neither
  side controls; each move tells the owner ("rejoined from a new device"), who can
  remove the membership; and the per-circle limit of decision 3 still applies to
  list picks. Against a rightful member with an address it is a stalemate: their
  link always works.
- **It does not help a member with no address.** They have no proof to tell them
  from the person who took their place, so the list's cap binds them: no more than
  three list picks in seven days can move a membership that way, and a taker with
  a mailbox can still retake after that. (The count walks the audit chain by
  identity, so an identity that has taken several places in a week can make it read
  high for a membership it has only just touched: it protects less than three picks
  would suggest. Older behaviour, noted on SUS-62.)
- **A taker who saves their place no longer keeps it from a link.** That was a
  residual of this ADR's first version and is closed by decision 6.

**5. The list still returns the user id, not an opaque handle.** The ticket asked
whether to replace `member_user_id` with a per-list handle so the list alone is
not enough to make the second call. Not done, for these reasons:

- A handle is only worth having if `reattach_member` checks it, which means a
  table of offers (caller, circle, target, expiry), written on every list call and
  cleaned by retention, and a change to the request contract, the Edge Function,
  the client and their tests: a change in five places to a security blocker's fix.
- What it would add over decisions 1 to 4 is narrow. The ids it hides are only
  ever shown to someone who held a live code at the time, or who was in the circle;
  a person holding one can still call the list again while the code is live. What
  a handle adds is that ids learnt while a code was live cannot be used after it
  died. With the cap, the per-circle limit, the owner's notice and decision 4 on
  the other side of it, that is a residual we accept for the first release.
- The residual is recorded on SUS-62 (abuse and rate limiting), which already
  carries per-token and per-circle limits across functions, so that it is weighed
  with the rest of the abuse model and not forgotten.

**6. An emailed link may take a place back from a saved account whose own email
is not the link's address.** (The founder's decision of 3 October 2026.) If
someone picks a guest from the Continue-as list and then saves the place as an
account, in place (`linkIdentity`) or through `claim_identity`, the real guest's
link used to answer "that place belongs to an account" and offer the taker's
sign-in: the guest could not get back. Now the link moves the place to the guest's
new session, **unless the account's own email is the link's address**, in which
case it is the same person signed in and keeps the place. A pick from the list
still never moves a saved place.

*Where it is enforced.* In SQL, in `reattach_member`, not in the Edge Function:
`private.takeback_allowed` decides, `private.hand_back_membership` moves. The link
is found by its hash, so the caller names no account and no circle. The token must
be unexpired and either unspent or **retired**: `retire_reentry_links` (called when
a membership passes to a saved account) now marks the links it spends with
`email_action_tokens.retired_at`, because a link spent by a claim is still the
member's to use, and a link spent by being used is not. Using a retired link
clears the mark, so it works once.

*A condition the founder's rule needs to be safe.* The rule is for one story: a
place was **picked from the list** and then saved, and the link is to the real
guest's own mailbox. So the link is honoured only if the chain of recorded moves
leading to the account holds a list pick, and the link's **address is one a link was
once minted for the place's first holder**: the identity nobody moved the place to
(or, in a loop, the earliest mover). `email_action_tokens.minted_for_user_id` (new,
fixed at issue, never moved with the place) records whom each link was minted for.
Keyed on the address, not on the identity the link names, so a guest who has changed
identity (a new device, an emailed return) and whose newest letter is minted for her
current one is still recognised (scenes 14 and 15). Without the condition, a link to
a taker's own mailbox, minted for somebody who held the place *later*, could take it
from the real guest once she had saved it, whether she came back by email or by
picking her own name, and a saved account has no link of its own to answer with, so
saving would leave her worse off than staying a guest. Three reviews found the
variants (scenes 10 and 13). A guest nobody picked from matches nothing, so her own
old links cannot take the place from her own account.

*The edge cases, settled:*

- **The account has no email of its own** (a phone sign-in): there is none to
  match, so the link is not the account holder's and takes the place back.
- **The address matches only by case** (`Guest@Example.com` against `guest@example.com`):
  the same address, and the account keeps the place. Compared lower-cased and
  trimmed, against `auth.users.email` and the email on every one of the account's
  sign-in identities.
- **The account holds other circles**: only this circle's membership moves
  (`move_membership` is scoped to one circle). The account keeps its other
  memberships, its sign-in and profile. Of its email contacts only the **link's
  address** moves with the place; the account's own address, its consent and any
  other address it attached stay with it (`reconcile_contacts` is told, by a
  transaction-local setting, to move that one contact). The account's other
  re-entry links for this circle are deleted, since a link must name its holder's
  own contact, and a link that can no longer move anything is of no use to them.
- **What the account holder sees afterwards**: the circle is gone from their list
  and unreadable (they have no membership and no tombstone), everything else is as
  it was. Nothing is sent to them (see "Who is told"). They can rejoin the
  ordinary ways (the circle's invite).
- **The weekly cap**: the move is an emailed-link move, which the founder already
  exempted (decision 4). It is recorded with `source: 'email'`, is never counted
  or refused, and the chain walk crosses it without charging it. The hourly
  per-circle limit applies to the list only.
- **Who is told, and how**: no new channel, and honestly little. The move writes the same audit row and
  emits the same `circles.member_reattached` event as every reattachment, so the
  owner sees "Priya rejoined from a new device" as before; for a take-back the
  audit row carries `from_saved_account: true` and the event adds the account's
  `from_user_id`, so the pipeline that tells the owner can name the other party too.
  No consumer of that event writes to the account holder in this release (the
  owner's notice is the circle-home line of §5.1, and nothing in the dispatcher
  sends an email for it): the record is there and the wording is the dispatcher's,
  not built here. This is the same as every existing takeover, where the person
  displaced is told nothing.
- **Not moved from the circle's owner, nor from the organiser of a plan that is
  still open** (not cancelled, expired or completed): an owner must stay a member
  (`enforce_owner_stays_member`), handing a circle on is its own operation, and every
  organiser guard also wants the organiser to be a member, so taking the place would
  strand the plan. The account keeps the place until the plan is over or the owner
  cancels it (a taker can use this to hold a place, at the price of making and
  keeping a plan; cancelling it is the owner's to do). The refusal is the existing
  `target_is_permanent`.
- **A claim that merged into an existing member's own membership** (the account
  was already in the circle; the guest's row is removed and its links now name the
  account's long-standing place): the link is plainly spent (`reconcile_contacts`
  clears `retired_at` when `p_from` still holds a membership), so it can never take
  that place. The guest's place was removed by the merge in any case.
- **Every doubt is a no**: the holder must be an account by `auth.users` (a profile
  flag alone is not enough, and a missing auth row is not), the link's contact must
  exist, and any error leaves the link unspent.

*Accepted by the founder, 3 October 2026:* the condition above (a list pick in the
chain, and the link's address minted for the first holder) and the residual stated
next. He also decided, the same day, that the plan-update consent sentence's
"changed" covers the letter that says a locked-in meetup moved
(`covers.moved: 'changed'` in `packages/config/src/consent.ts`, no new consent
version; see ADR 0051).

*Residuals, plainly.* Anybody who can read the real guest's mailbox can use her
link, as before. A guest with two addresses gets the link's address back with the
place; her other address and its consent for this circle stay with the account.
A guest who was picked (even picking her own name on a new device counts as a pick)
and then saved under a different address (an Apple relay) can have her own old
link take the place from her own account: the rule cannot tell a self-pick from a
taker's, and she can save again from the browser the link opened in. The take-back
is not counted toward the cap, as decided.

## Alternatives considered

- **`collecting` and `ready` only**, as the narrowest reading. Rejected by the
  founder's own decision: §6.2's journey is a guest tapping "Locked in" in the
  chat, which opens a **confirmed** plan.
- **A shorter window with no `completed`.** Rejected, as above: answering the
  morning-after question would end attendance reporting.
- **Counting only the list's moves, but still refusing a token move when the cap
  is full.** Rejected: that is the failing case.
- **Rate limiting only in the Edge Function.** The status quo, and the finding.

## Consequences

- `guest_members_for_reattach`, `preview_for_code`, `reattach_member` and four new
  private functions change in one migration (`0033`, ADR 0015). No table
  changes: the audit row's `metadata` carries `source`.
- A guest who opens the link of a cancelled or expired plan, a plan whose meetup is
  more than fourteen days past, or an archived circle's plan sees "This link isn't
  active any more." (a null circle name now says so, in `ContinueAsFlow` and `JoinAsAccountFlow`). The link-preview card for such a plan is the generic one.
- ADR 0022's single end state for a newcomer on a plan that is not asking splits
  in two. A link that is not live (as above, and a code that never existed)
  ends at "This link isn't active any more" before any name is asked, for guests
  and for accounts alike. A link that is live but not taking answers (replies
  closed, or locked in recently) still asks for a name and then says "You need the
  invite link to join". Nothing is let in on either path, and what the first
  says is what `preview_for_code` already tells any chat app that unfurls the
  link.
- A plan still `confirmed` after N, because nobody answered "did it happen?",
  stops offering Continue-as; the organiser can still answer, and the people with
  an emailed link can still get back in. Nothing else about the plan changes.
- The circle's own code is resolvable while the circle is active, as decided.
  No product link carries it today (plan links and the invite fragment are what
  the product shares), so this affects a direct RPC caller only.
- Spec §5.1 and the architecture's Continue-as paragraph say so.

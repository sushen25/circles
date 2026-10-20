---
adr: 83
title: "An account is deleted at once and purged after thirty days, a member can leave, and everyone can export their own data"
status: accepted
date: 2026-10-20
builds_on: [5, 14, 74]
---
# ADR 0083: An account is deleted at once and purged after thirty days, a member can leave, and everyone can export their own data

_Status: accepted · 20 October 2026 · builds on [ADR 0005](0005-willing-windows-retained-12-months.md), [ADR 0014](0014-retention-runs-in-the-database.md) and [ADR 0074](0074-a-suppressed-contact-keeps-a-hash-and-the-sign-in-log-and-events-are-bounded.md)_

## Context

Spec §13 says leaving, deleting and exporting are always available, and the
privacy pages were rewritten (SUS-102) to say that they are not yet. S4-05
builds them. Three things made this more than a button.

Deleting an `auth.users` row failed for most real accounts. Five foreign keys
pointed at it with no action: `circles.owner_user_id`,
`circle_invites.created_by`, `plans.organiser_user_id`,
`meetup_confirmations.confirmed_by` and `outcome_reports.reported_by`. Anyone
who had owned, organised, confirmed, reported or rotated an invite could not be
deleted, even from the dashboard.

`jobs.run_retention` was one transaction, so the first foreign-key error in any
rule would have stopped every rule, every day. The purge makes that error easy
to cause.

And "deleted" has two meanings that must not be confused: the person is gone
to everybody else, and cannot sign in, *now*; the data is gone in thirty days.

## Decision

1. **`delete-account` does the first meaning in one transaction**
   (`public.delete_account`, a permanent identity only; guests leave
   circles). Circles they own go to the longest-standing permanent member, or
   are archived when there is none; plans they organise go to the
   longest-standing permanent participant, or to nobody (a plan with no
   organiser is already legal); every membership becomes `removed` with the
   name 'Former member', so `on_member_removed` deletes their answers and
   windows, bumps the plans' input versions and the Edge Function recalculates
   them; email subscriptions are withdrawn, scheduled letters skipped, their
   contacts deleted; push devices disabled; **sessions deleted and the user
   banned in the same transaction**, so "cannot sign in" is a committed fact and
   not a second call that might fail; the Edge Function also revokes the
   token's session through the auth API. `identity.account_deleted` goes to the
   outbox and the audit log. Asking twice does nothing the second time.
2. **The purge is the second meaning.** `private.account_deletions` records
   who asked and when it is due. `jobs.run_retention` calls
   `private.purge_account` for each due account, one subtransaction each: it
   deletes the circles they still own (an archived circle with its plans),
   takes their id out of the audit log's actor and subject columns and out of
   the lists of who was free (replaced by the nil uuid in a stored candidate set,
   which counts its people), and deletes the auth user. The cascade takes the
   profile, memberships, attendance, nudges, devices and everything else keyed on it.
3. **The five foreign keys.** `circles.owner_user_id` stays `not null` with no
   action: a circle has an owner until it is archived and deleted.
   `circle_invites.created_by`, `meetup_confirmations.confirmed_by` and
   `outcome_reports.reported_by` become nullable `on delete set null`, and
   `plans.organiser_user_id` (already nullable) becomes `on delete set null`.
   Who issued a link, pressed Lock it in or reported an outcome is history
   nothing reads to decide; the link, the time and the outcome stay.
   `analytics.events.user_id` already followed (ADR 0074).
4. **An archived circle with nobody to go to is deleted with its owner's purge.** (One already archived that has an heir is handed on like any other, and the preview lists every circle the person owns.) The auth user
   cannot go while it owns a circle, and a circle whose owner is deleting and
   which has no other saved-place member has nobody who can act on it. Its
   guests lose it after thirty days. The screen says so before the owner
   confirms. `enforce_owner_stays_member` no longer protects an archived circle,
   so an owner can be removed from one.
5. **Contacts are deleted, not suppressed.** A suppression is a tombstone for
   the *address* and also suppresses every other contact holding it; a person
   who deletes and comes back would be silenced. There is nothing to protect
   by keeping the row: no letter is owed to a deleted account.
6. **`leave-circle` is the owner's Remove done by the person,** and, like a deletion, hands on the named plans they organise (`private.hand_on_plans`; a quiet plan's organiser is cleared, never given to anybody). Any active
   member, guests included. The same trigger does the same things, the name is
   kept, and the owner cannot leave (they delete the account, which hands the
   circle on). A guest's anonymous identity is not purged by it; that is
   [SUS-117](https://linear.app/sushen-project/issue/SUS-117)'s.
7. **`export-my-data` is a POST that answers with the document** and has no
   idempotency key, so the kit never records the answer in
   `jobs.idempotent_requests`. The document is built from rows keyed on the
   caller's id, not from "everything minus what they must not see", and holds
   no other member's id, name or address, no push token, and the address only
   as a hint. One a day, enforced in the SQL function and not only the Edge
   Function.
8. **`jobs.run_retention` runs each rule in its own subtransaction.** A rule
   that raises is rolled back alone, its name goes in `failed_rules` in the
   run's audit row, and the sqlstate (nothing else) in the Postgres log.

## Alternatives considered

- **Anonymise to a tombstone user and keep every column `not null`.** Works for
  four of the five, not for ownership, and leaves a real auth row standing for
  every deletion.
- **Delete the auth user at once.** Loses the thirty-day window the ticket and
  the architecture promise, and every cascade runs inside the request.
- **Ban through the auth API only.** If the call after the commit failed, a
  deleted person could sign in. The database does it in the transaction.
- **Suppress the contacts** (item 5).
- **Keep an archived circle for ever, owned by nobody.** Needs the foreign key
  to allow it and leaves an unreachable circle's data and guests' names
  indefinitely. Raised as a question for the founder; this is the default.

## Consequences

- A deleted person's attendance rows go with the cascade at the purge. What
  survives is what has no id to follow: confirmations and outcome reports
  without a `confirmed_by` or `reported_by`, analytics events without a
  `user_id`.
- Between the deletion and the purge, the profile, the `private.*` rows and the
  auth row still exist, and the person cannot use them. The privacy pages say
  thirty days, and no longer.
- The notes, place names and analytics a deleted person wrote in a circle that
  carries on stay with the circle (and the hashed device id on their analytics
  events). How long they are kept is [SUS-117](https://linear.app/sushen-project/issue/SUS-117)'s decision, not this one.
- `Confirmation.confirmedBy` in the domain is `UserId | null`.
- A purge that fails for one person is named in the run and tried again the
  next day; it does not hold up the others.
- An access token issued before a deletion lives up to an hour. It reads nothing
  (every membership is gone) and `auth_is_permanent` refuses it, so it cannot
  create a circle; Edge Functions reject it because its session is gone.
- Still left, and tolerated: unprocessed outbox payloads and the auth service's
  own sign-in log (90 days) can name the person until their own retention ends.

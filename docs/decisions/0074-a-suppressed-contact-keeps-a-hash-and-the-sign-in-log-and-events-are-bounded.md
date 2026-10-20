---
adr: 74
title: "A suppressed contact keeps a hash and not the address; the sign-in log is pruned; an event follows its user"
status: accepted
date: 2026-10-15
builds_on: [5, 14, 25, 57]
---
# ADR 0074: A suppressed contact keeps a hash and not the address; the sign-in log is pruned; an event follows its user

_Status: accepted · 15 October 2026 · builds on [ADR 0005](0005-willing-windows-retained-12-months.md), [ADR 0014](0014-retention-runs-in-the-database.md), [ADR 0025](0025-the-preferences-link-is-minted-with-each-email.md) and [ADR 0057](0057-who-started-a-plan-is-kept-as-long-as-the-plan.md)_

## Context

SUS-191. Three places held something about a person for longer than anything
needed it, and no rule bounded them.

- A contact that bounced, complained or unsubscribed kept its address in clear
  for ever. Retention deleted only verified contacts, on the reasoning that the
  suppression list has to outlive the address. It does, but the suppression list
  is a hash (`private.email_suppressions`); the clear address on the contact row
  adds nothing to the promise not to send again, and nothing mails a suppressed
  contact. "Remove" on the preferences page (ADR 0025) already deleted the
  plaintext for exactly this reason; a bounce did not.
- The auth service's own audit log (`auth.audit_log_entries`) records every
  sign-in with the address that signed in, and was never pruned.
- `analytics.events.user_id` had no foreign key, so an event outlived its user
  with the identity still on it, and the routine that deletes an account could
  not find it by constraint. The spec says deletion nulls identifiers and keeps
  the history; nothing made that true.

## Decision

**1. Suppression nulls the address.** `private.apply_suppression` is now a
`before insert or update of email_normalized, status` trigger. It keeps
`email_hash` equal to the hash of the address while there is one, and when a row
is suppressed, by any path (a bounce, a complaint, an unsubscribe, a sibling
suppressed with it, or an insert for a tombstoned address) it sets
`email_normalized` to null. The hash stays. To make that possible `email_hash`
stopped being a generated column and became a plain one that only the trigger
writes from an address; a writer that supplies a hash with an address has it
overwritten, and a writer copying a suppressed row (which has only the hash)
supplies it. A check, `email_contacts_address_kept`, says the address is null
exactly when the status is `suppressed`. Migration 0060 nulls the addresses of
every contact already suppressed.

Code that read the address of a contact it did not know to be mailable now reads
the hash instead: `takeback_allowed` compares the hash of the holder's own
address, and the dispatcher's claim returns a null address for a suppressed
contact, which the sender skips before it looks at it.

**2. Retention takes suppressed contacts on the verified clock.** The 30-day
plan-only rule now covers `verified` and `suppressed`: no plan the contact was
subscribed to is still running or finished less than 30 days ago, no letter is
still waiting for it, and 30 days have passed since it was verified or, for a
suppressed one, suppressed. A suppressed contact is not spared for being
somebody's own sign-in address: that exemption exists so an organiser can be
written to, and a suppressed contact is not written to. The tombstone in
`email_suppressions` is never deleted, and a contact created later for that
address arrives suppressed.

**3. The auth audit log is kept 90 days.** `jobs.run_retention` deletes
`auth.audit_log_entries` older than 90 days, as the owner like the rest of the
function. Ninety days is long enough to look into a sign-in problem and short
enough that the table is not a second copy of who signed in, ever.

**4. `analytics.events.user_id` is a foreign key to `auth.users` on delete set
null.** Chosen over a retention step that nulls it later because a constraint
makes the spec's sentence true on the day an account is deleted, with nothing to
schedule and nothing to forget; and because SUS-177 (ADR 0057) moved the one fact
that mattered, who started a plan, into `private.audit_log`, so nulling a user on
an event loses attribution and nothing the founder views read as a gate. The
migration nulls the events whose user is already gone before adding the
constraint. `record_events` writes a null in place of a user that no longer
exists, so a bearer that outlives its user by up to an hour cannot fail a whole
batch.

## Alternatives considered

- **Leave the address and delete the row sooner.** Still holds a clear address
  for the days until it goes, and the sibling and re-insert paths would each need
  their own deletion. Nulling at the moment of suppression is one rule.
- **Keep `email_hash` generated and store the address elsewhere.** A second table
  of addresses to join on every send, to avoid changing one column.
- **A retention step instead of the foreign key.** Leaves events with a stale
  identity for up to a day after every deletion and a step to remember; also
  nothing would stop a later table repeating the omission.
- **Validate the new constraint online.** The table is small before launch and
  the migration says what to do if that stops being true.

## Consequences

- No table holds a clear address for a contact that will never be mailed.
- The deletion routine (SUS-66) needs nothing for `analytics.events`. It does need
  an action for five foreign keys to `auth.users` that block deleting a user who
  created a circle, an invite or a plan, confirmed a meetup or reported an
  outcome; that is written on SUS-66 and not decided here.
- Writing an address and a hash in one insert is still allowed, and the trigger
  wins. `email_hash` can no longer be trusted by a reader who did not read the
  trigger; this record and the column comment are where it is said.
- The first retention run after this ships deletes the whole backlog of auth
  audit entries older than 90 days in one statement.

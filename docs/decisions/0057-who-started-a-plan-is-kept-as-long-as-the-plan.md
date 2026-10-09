# ADR 0057: Who started a plan is kept as long as the plan, not for twelve months

_Status: proposed · 9 October 2026 · amends architecture §8.5 ("Audit log: 12 months") for one action, and builds on the note in migration 0003 that who created a plan belongs in the audit log_

## Context

The founder analytics screen (SUS-166) counts the plans somebody other than a
circle's owner started. Who *started* a plan is not who organises it now (a
hand-off moves the organiser), so the gate read it from the creation's outbox
event (kept 30 days) or the client's own `plan_created` event (which an offline
phone, a blocker or a crash before the batch flushes can lose). The screen said
so as a stated limit.

`plans` has deliberately had no `created_by` since migration 0003: it is
readable by every member, and on a quiet ask the creator is the initiator.

## Decision

`create_plan` writes one `private.audit_log` row in the plan's own transaction:
action `plan.created`, resource type `plan`, `resource_id` the plan, `actor_user_id`
the creator, `occurred_at` the plan's creation time, no metadata. The gate
`analytics.gate_other_organiser` reads that row and nothing else. Named plans
only: `create_quiet_ask` writes no such row, so a quiet ask's initiator stays in
`private.plan_initiators`.

`jobs.run_retention` keeps the 12-month rule for every other audit row and
leaves `plan.created` alone while its plan exists. When the plan is gone (a
circle's deletion cascades to its plans) the row is deleted by the next run.
The founder screen reads back 400 days and a plan outlives a year, so a 12-month
rule would have made the gate lose plans it had once counted.

Plans that exist when the migration runs are backfilled from what the server
still has: the outbox event, else the client event. A plan with neither gets no
row, and the screen says plans from before the record count only where their
creator could be recovered.

## Alternatives considered

- **A `created_by` column on `plans`.** Rejected for the reason in migration
  0003: the table is readable by every member, and the column is the leak that
  was removed once.
- **The audit log's ordinary 12 months.** Simpler, but it ages out a fact the
  gate still reads, and the dashboard would quietly count fewer plans each
  month.
- **A new private table.** Holds the same three fields in a second place with
  its own retention. The audit log already is that place, is unread by clients,
  and takes the same no-content check.
- **Backfill from the plan's current organiser.** Wrong after a hand-off, and
  indistinguishable from a right answer.

## Consequences

- The "other organiser" gate no longer depends on a client event or a 30-day
  window for plans created from now on.
- One audit row per named plan, ids and a timestamp, kept as long as the plan.
- Architecture §8.5 gains the exception.
- A plan from before this change whose creator the server and the client had both
  lost is not counted, and cannot be recovered.

# ADR 0014: Retention runs in the database from pg_cron, not in the dispatcher

_Status: accepted · Date: 10 September 2026_

## Context

Architecture §9.1 listed "retention" among the duties of `process-scheduled-jobs`,
the Edge Function pg_cron invokes every minute, while §8.5 described the
retention rules as "pg_cron, daily" without saying who runs them. S1-12's ticket
asked for `cron.schedule('retention', '15 3 * * *', $$ select jobs.run_retention() $$)`
— retention as a database function on its own daily schedule — which is not what
§9.1 said, and a ticket is not the architecture.

The two candidates differ in what they can reach. S1-11 (0006) gave the service
role — the identity an Edge Function runs as — no `delete` on `private.audit_log`
or `analytics.events`, and nothing at all on `auth.users`, on purpose: an Edge
Function with the power to purge is a larger surface than the product needs to
carry. Retention deletes from exactly those places: audit rows after twelve
months, abandoned anonymous identities after thirty days. Running it as the
dispatcher would mean either widening the service role or duplicating the rules
in a second privileged function it calls.

## Decision

Retention is `jobs.run_retention()`, a `security definer` function owned by the
database owner, scheduled by pg_cron directly (`retention`, daily at 03:15) and
executable by nobody else — not the service role, not a client role. One rule
per statement, one count per rule returned and written to `private.audit_log`.
`process-scheduled-jobs` does not run retention; §9.1 no longer lists it there.

The minute job remains the dispatcher's: pg_cron calls
`jobs.invoke_process_scheduled_jobs()`, which posts to the Edge Function under
the lease. Retention has its own lease name (`retention_daily`) for the health
job to read but does not take it: a daily job on a single cron instance cannot
overlap itself.

## Alternatives considered

- **Retention inside `process-scheduled-jobs`, as §9.1 said** — the dispatcher
  would need `delete` on the audit log, analytics and `auth.users`, or a
  privileged database function that does the deleting anyway. The second is this
  decision with an extra hop; the first widens the service role for a job that
  runs once a day.
- **A separate retention Edge Function** — the same privilege problem, plus a
  second function to deploy and secure for work that is entirely SQL.
- **Supabase Vault for the cron settings** — orthogonal, noted in the runbook;
  the settings guard the cron → function hop only.

## Consequences

- The service role keeps its narrow grants (0006); nothing outside the database
  can purge history.
- Retention rules are tested where they run: `080_retention.sql` exercises each
  rule with one row it must delete and one it must not, and the day-part summary
  written before the twelve-month rule (ADR 0005).
- A change to a retention rule is a migration, not a function deploy.
- The health summary (S1-20) reads `jobs.cron_leases.last_finished_at` and the
  `retention.ran` audit rows rather than a job result of its own.

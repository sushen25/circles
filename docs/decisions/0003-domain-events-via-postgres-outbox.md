# ADR 0003: Publish domain events through a Postgres outbox drained by cron, not database webhooks

_Status: accepted · Date: 6 September 2026_

## Context
Notifications, email, analytics and cadence depend on state changes across contexts. They must be delivered exactly once per (recipient, plan, revision, kind, occurrence), in order, with retries, and must never be lost if a downstream call fails. Supabase database webhooks fire per row change with no ordering or retry guarantees and would couple table shape to notification logic.

## Decision
Every state-changing Postgres function appends a row to `jobs.outbox` in the same transaction. `process-scheduled-jobs` (invoked by pg_cron every minute, under a lease row) drains the outbox in order, applies eligibility rules from `packages/domain/communication`, and creates `jobs.notification_jobs` with unique idempotency keys before any external call. Cron is the only trigger; there are no in-memory timers.

## Alternatives considered
- **Supabase database webhooks → Edge Functions** — simpler wiring, but at-least-once without ordering, and no transactional guarantee that the event exists iff the state change committed.
- **Realtime channels as a bus** — not durable.
- **A queue vendor** — a second system to operate for a handful of events per day.

## Consequences
- Delivery latency is up to one minute; acceptable for every notification kind in the spec.
- The outbox table must be pruned (30 days) and monitored for stuck rows; the health job reports them.
- Concurrency is handled by the lease row and by `for update skip locked` on jobs.

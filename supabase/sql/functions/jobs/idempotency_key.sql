-- ---------------------------------------------------------------------------
-- `hash(channel, recipient, plan, revision, kind, occurrence)` — architecture
-- §13's key, in SQL.
--
-- The formula belongs to `packages/domain/communication/idempotency.ts` and is
-- written twice only because both writers need it: the dispatcher computes keys
-- in TypeScript, and the functions that enqueue an email from inside a
-- transaction know ids — a token's, a confirmation's — that no caller could
-- have passed in. A key composed two different ways is two jobs where the
-- unique index was meant to allow one, which is a second email to somebody who
-- has already had it.
--
-- So this mirrors the canonical form exactly, length prefixes and all: a plain
-- separator would let `('ab','c')` and `('a','bc')` collide, and a collision
-- here is a notification that silently never arrives. `130_jobs_keys.sql` pins
-- it to a value the domain's own function produces, so the two cannot drift
-- without a test saying so.
-- ---------------------------------------------------------------------------

create or replace function jobs.idempotency_key(
  p_channel text,
  p_recipient text,
  p_plan text,
  p_revision text,
  p_kind text,
  p_occurrence text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      concat(
        length(p_channel), ':', p_channel,
        length(p_recipient), ':', p_recipient,
        length(coalesce(p_plan, '')), ':', coalesce(p_plan, ''),
        length(coalesce(p_revision, '')), ':', coalesce(p_revision, ''),
        length(p_kind), ':', p_kind,
        length(p_occurrence), ':', p_occurrence
      ),
      'sha256'
    ),
    'hex'
  );
$$;

comment on function jobs.idempotency_key(text, text, text, text, text, text) is
  'The notification idempotency key of architecture §13, mirroring idempotencyKey() in packages/domain. Pinned to the domain''s output by 130_jobs_keys.sql.';

revoke all on function jobs.idempotency_key(text, text, text, text, text, text) from public;
revoke all on function jobs.idempotency_key(text, text, text, text, text, text) from anon, authenticated;
grant execute on function jobs.idempotency_key(text, text, text, text, text, text) to service_role;

-- The notification idempotency key, pinned to the domain's.
--
-- `jobs.idempotency_key` mirrors `idempotencyKey` in
-- `packages/domain/communication/idempotency.ts`, because both writers need it:
-- the dispatcher composes keys in TypeScript, and the functions that enqueue an
-- email from inside a transaction know ids — a token's, a confirmation's — that
-- no caller could have passed in. Two implementations of one formula is a thing
-- a test has to hold together, because the failure is silent: a key composed
-- differently is a second job where the unique index was meant to allow one,
-- which is a second email to somebody who has already had it.

begin;
select plan(4);

-- The expected values come from the domain itself:
--
--   node -e "const {idempotencyKey, idempotencyInput} =
--     require('./packages/domain/dist/communication/idempotency.js');
--     const parts = {channel:'email',
--       recipientId:'11111111-1111-4111-8111-111111111111',
--       planId:'22222222-2222-4222-8222-222222222222', revision:3,
--       kind:'verify_email',
--       occurrence:'33333333-3333-4333-8333-333333333333'};
--     console.log(idempotencyInput(parts)); idempotencyKey(parts).then(console.log)"
select is(
  jobs.idempotency_key(
    'email', '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', '3',
    'verify_email', '33333333-3333-4333-8333-333333333333'),
  '04b11c9c1d1be9470e0e34a278f321833455acfe08a62f4cbea22ccbde83e8eb',
  'the same inputs give the same key here as in packages/domain'
);

-- Length prefixes, which is the whole reason the canonical form is not a join
-- with separators: `('ab','c')` and `('a','bc')` would otherwise be one key,
-- and a collision is a notification that silently never arrives.
select isnt(
  jobs.idempotency_key('email', 'ab', 'c', '1', 'locked_in', 'x'),
  jobs.idempotency_key('email', 'a', 'bc', '1', 'locked_in', 'x'),
  'and a boundary cannot be moved without changing the key'
);

select is(
  length(jobs.idempotency_key('push', 'u', 'p', '1', 'reminder', 'o')),
  64,
  'sixty-four hex characters, which is what notification_jobs_key_shape asks for'
);

select ok(
  not has_function_privilege('authenticated', 'jobs.idempotency_key(text, text, text, text, text, text)', 'execute'),
  'and no client role can compute one: a key is how a job is deduplicated, not something to guess at'
);

select * from finish();
rollback;

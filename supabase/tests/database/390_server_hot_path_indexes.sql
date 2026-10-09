-- SUS-175: the four lookups the server makes on every request or every minute
-- have an index. No other suite asserts an index; this one sets the pattern.
--
-- `has_index(schema, table, index, columns)` fails if the index is missing or
-- covers other columns, so a rename or a reordering of columns is a test failure
-- rather than a silent return to a sequential scan.

begin;
select plan(9);

-- invite_preview (anon, the Join page) and redeem_invite
select has_index('public', 'circle_invites', 'circle_invites_secret_hash_key', 'secret_hash',
  'an invite is found by the digest of its secret without reading every invite');
select is(
  (select indisunique from pg_index where indexrelid = 'public.circle_invites_secret_hash_key'::regclass),
  true,
  'and one digest names at most one invite');

-- dispatch_timed_work: "has this plan already had this event", every minute
select has_index('jobs', 'outbox', 'outbox_aggregate_event_idx', array['aggregate_id', 'event_name'],
  'the outbox is searched by plan and event name');
select hasnt_index('jobs', 'outbox', 'outbox_aggregate_idx',
  'the index that led on aggregate_type, which nothing filters by, is gone');

-- record_email_delivery: once per Resend webhook
select has_index('jobs', 'notification_jobs', 'notification_jobs_provider_message_idx', 'provider_message_id',
  'a delivery event finds its job by the provider''s message id');
select matches(
  (select pg_get_expr(indpred, indrelid) from pg_index
    where indexrelid = 'jobs.notification_jobs_provider_message_idx'::regclass),
  'provider_message_id IS NOT NULL',
  'and only indexes the jobs that have one');

-- run_retention, reconcile_contacts, dispatch_claim_due's `superseded`, and the
-- cascade from email_contacts
select has_index('jobs', 'notification_jobs', 'notification_jobs_contact_kind_idx',
  array['contact_id', 'kind'],
  'a contact''s jobs are found without reading every job');
select matches(
  (select pg_get_expr(indpred, indrelid) from pg_index
    where indexrelid = 'jobs.notification_jobs_contact_kind_idx'::regclass),
  'contact_id IS NOT NULL',
  'and push jobs, which have no contact, are not in it');

-- Nothing else on the outbox changed: the drain still has its own index.
select has_index('jobs', 'outbox', 'outbox_unprocessed_idx', 'seq',
  'the dispatcher''s drain index is untouched');

select * from finish();
rollback;

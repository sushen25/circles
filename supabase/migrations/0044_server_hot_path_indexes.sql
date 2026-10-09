-- 0044_server_hot_path_indexes
--
-- Four indexes for lookups the server makes on every request or every minute and
-- that Postgres can only answer by reading the whole table (SUS-175). Postgres
-- indexes a primary key and a unique constraint on its own; it does not index a
-- foreign key or a column somebody merely reads by.
--
-- Plain `create index`, not `concurrently`: a migration runs in a transaction,
-- and `concurrently` cannot. These tables are small (invites are one per circle
-- plus the revoked ones; the outbox keeps 30 days of processed rows; sent jobs
-- are one per letter), so the lock is held for milliseconds.

-- `invite_preview` (granted to anon, behind the Join page) and `redeem_invite`
-- look an invite up by the digest of its secret. A visitor can trigger the
-- first by opening a link, and it read every invite, live and revoked. The
-- digest is 256 bits of a random or HMAC-derived secret, so unique is a fact
-- about the data rather than a new rule; as a constraint it also documents that
-- one digest names at most one invite.
alter table public.circle_invites
  add constraint circle_invites_secret_hash_key unique (secret_hash);

-- `dispatch_timed_work` asks "has this plan already had this event?" in every
-- loop, every minute, with `aggregate_id` and `event_name` and never the
-- aggregate's type. The old index led on `aggregate_type`, which nothing in
-- `supabase/sql` or the functions filters by, so it could not serve any of them.
-- Replaced rather than kept beside: it is written on every outbox insert and
-- read by nothing.
drop index jobs.outbox_aggregate_idx;
create index outbox_aggregate_event_idx on jobs.outbox (aggregate_id, event_name);

-- `record_email_delivery`, once per Resend webhook: the job a provider message
-- belongs to. Partial, because most jobs (every push) have none.
create index notification_jobs_provider_message_idx
  on jobs.notification_jobs (provider_message_id)
  where provider_message_id is not null;

-- `run_retention`, `reconcile_contacts`, the `superseded` check in
-- `dispatch_claim_due`, and the cascade when an `email_contacts` row is deleted
-- all go from a contact to its jobs. Push jobs have no contact.
create index notification_jobs_contact_kind_idx
  on jobs.notification_jobs (contact_id, kind)
  where contact_id is not null;

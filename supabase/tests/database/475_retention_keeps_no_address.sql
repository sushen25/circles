-- What the database keeps about a person once nothing needs it (SUS-191):
-- a suppressed contact holds the hash and not the address, and an analytics
-- event follows its user out.
--
-- The retention rules themselves (suppressed contacts deleted on the verified
-- clock, the auth audit log bounded at 90 days) are in 080_retention.sql.

begin;
select plan(17);

create or replace function pg_temp.make_user(id uuid, name text)
returns uuid language sql as $$
  insert into auth.users (
    id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    id::text || '@example.com', false, '{}'::jsonb,
    jsonb_build_object('display_name', name, 'time_zone', 'Australia/Melbourne'), now(), now()
  ) returning id;
$$;

select pg_temp.make_user('00000000-0000-0000-0000-0000000007a1', 'Maya');
select pg_temp.make_user('00000000-0000-0000-0000-0000000007a2', 'Nina');
select pg_temp.make_user('00000000-0000-0000-0000-0000000007a3', 'Tom');

-- ---------------------------------------------------------------------------
-- Suppression nulls the address, by every path
-- ---------------------------------------------------------------------------
insert into private.email_contacts (user_id, email_normalized, status, verified_at) values
  ('00000000-0000-0000-0000-0000000007a1', 'bounce@example.com', 'verified', now()),
  ('00000000-0000-0000-0000-0000000007a2', 'bounce@example.com', 'verified', now()),
  ('00000000-0000-0000-0000-0000000007a1', 'fine@example.com', 'verified', now());

select is(
  (select count(*)::integer from private.email_contacts where email_normalized is not null),
  3,
  'a verified contact keeps its address: it is mailed to'
);

update private.email_contacts set status = 'suppressed', suppressed_at = now(), suppression_reason = 'bounced'
where user_id = '00000000-0000-0000-0000-0000000007a1' and email_hash = extensions.digest('bounce@example.com', 'sha256');

select is(
  (select email_normalized from private.email_contacts
   where user_id = '00000000-0000-0000-0000-0000000007a1' and email_hash = extensions.digest('bounce@example.com', 'sha256')),
  null,
  'a contact that bounces loses its address in the same statement'
);
select is(
  (select status from private.email_contacts
   where user_id = '00000000-0000-0000-0000-0000000007a1' and email_hash = extensions.digest('bounce@example.com', 'sha256')),
  'suppressed',
  'and is still suppressed, found by its hash'
);
select is(
  (select reason from private.email_suppressions where email_hash = extensions.digest('bounce@example.com', 'sha256')),
  'bounced',
  'the tombstone is written, so the promise not to send does not depend on the address'
);
select is(
  (select email_normalized from private.email_contacts
   where user_id = '00000000-0000-0000-0000-0000000007a2' and email_hash = extensions.digest('bounce@example.com', 'sha256')),
  null,
  'the sibling suppressed with it loses its address too'
);
select is(
  (select email_normalized from private.email_contacts where email_hash = extensions.digest('fine@example.com', 'sha256')),
  'fine@example.com',
  'and a contact nobody suppressed keeps it'
);

-- An address that is already tombstoned arrives with no address at all.
insert into private.email_contacts (user_id, email_normalized)
values ('00000000-0000-0000-0000-0000000007a3', 'bounce@example.com');
select is(
  (select array[status, coalesce(email_normalized, '(none)')] from private.email_contacts
   where user_id = '00000000-0000-0000-0000-0000000007a3'),
  array['suppressed', '(none)'],
  'a contact made later for a tombstoned address arrives suppressed, holding no address'
);
select is(
  (select email_hash from private.email_contacts where user_id = '00000000-0000-0000-0000-0000000007a3'),
  extensions.digest('bounce@example.com', 'sha256'),
  'with the hash of the address it was made for'
);

-- A copy of a suppressed contact for another identity (`reconcile_contacts`
-- splitting one) has only the hash to copy.
select lives_ok(
  $$insert into private.email_contacts (user_id, email_normalized, email_hash, status, suppressed_at, suppression_reason)
    select '00000000-0000-0000-0000-0000000007a2', c.email_normalized, c.email_hash, c.status, c.suppressed_at, c.suppression_reason
    from private.email_contacts c where c.user_id = '00000000-0000-0000-0000-0000000007a3'
    on conflict (email_hash, user_id) do nothing$$,
  'a suppressed contact can be copied from its hash alone'
);

-- The table cannot be put in a state where the two disagree.
select throws_ok(
  $$insert into private.email_contacts (user_id, email_hash, status)
    values ('00000000-0000-0000-0000-0000000007a3', extensions.digest('nobody@example.com', 'sha256'), 'pending')$$,
  '23514', null,
  'a contact that is not suppressed cannot have no address'
);
select throws_ok(
  $$update private.email_contacts set status = 'pending', suppressed_at = null, suppression_reason = null
    where user_id = '00000000-0000-0000-0000-0000000007a3'$$,
  '23514', null,
  'and a suppressed one is never reactivated: with no address there is nothing to reactivate'
);

-- ---------------------------------------------------------------------------
-- analytics.events.user_id follows the user
-- ---------------------------------------------------------------------------
insert into analytics.events (event_id, event_name, schema_version, user_id, properties) values
  ('00000000-0000-0000-0000-0000000008e1', 'test_event', 1, '00000000-0000-0000-0000-0000000007a1', '{}'),
  ('00000000-0000-0000-0000-0000000008e2', 'test_event', 1, '00000000-0000-0000-0000-0000000007a2', '{}');

select throws_ok(
  $$insert into analytics.events (event_id, event_name, schema_version, user_id, properties)
    values ('00000000-0000-0000-0000-0000000008e3', 'test_event', 1, '00000000-0000-0000-0000-0000000007ff', '{}')$$,
  '23503', null,
  'an event cannot name a user that does not exist'
);

delete from auth.users where id = '00000000-0000-0000-0000-0000000007a1';

select is(
  (select count(*)::integer from analytics.events where event_id = '00000000-0000-0000-0000-0000000008e1'),
  1,
  'deleting a user keeps their event'
);
select is(
  (select user_id from analytics.events where event_id = '00000000-0000-0000-0000-0000000008e1'),
  null,
  'with the identity taken off it'
);
select is(
  (select user_id from analytics.events where event_id = '00000000-0000-0000-0000-0000000008e2'),
  '00000000-0000-0000-0000-0000000007a2'::uuid,
  'and leaves everybody else''s alone'
);

-- The ingest function is service-role and takes a user id from a bearer that
-- may outlive the user by an hour.
select is(
  public.record_events(jsonb_build_array(jsonb_build_object(
    'event_id', '00000000-0000-0000-0000-0000000008e4', 'event_name', 'test_event', 'schema_version', 1,
    'user_id', '00000000-0000-0000-0000-0000000007a1', 'occurred_at', now()))),
  1,
  'an event ingested for a user deleted a moment ago still lands'
);
select is(
  (select user_id from analytics.events where event_id = '00000000-0000-0000-0000-0000000008e4'),
  null,
  'without the identity'
);

select * from finish();
rollback;

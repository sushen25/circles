-- ---------------------------------------------------------------------------
-- 0010 — the Edge Function kit's two tables, and the identity-continuity
-- functions the first three functions are built on (S1-13).
--
-- Everything an Edge Function needs that is not a domain table lives in `jobs`:
-- the record of which client requests have already been served, and the
-- counters that say how often a thing may be asked for. Both are the service
-- role's alone — no client role has a grant, and neither table is exposed
-- through PostgREST.
--
-- The functions themselves (`redeem_invite`, `reattach_member`,
-- `claim_identity`, `guest_members_for_reattach`, `private.move_membership`)
-- live one per file under `supabase/sql/functions/` and arrive in the generated
-- block at the end (ADR 0015).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Idempotent requests.
--
-- §9.1: every mutation is "idempotent on a client-supplied `Idempotency-Key`".
-- The retry this guards against is the one where the client never saw a
-- response and cannot tell a timeout from a failure — on a phone, on a train,
-- which is most of this product's traffic.
--
-- Keyed by (function, caller, key) rather than by key alone: an idempotency key
-- is the client's, and one client's key must not be able to fetch another
-- client's answer. `request_fingerprint` is the digest of the body, so reusing
-- one key for a *different* request is a conflict rather than a wrong answer
-- returned confidently.
--
-- The stored response can hold a circle's name. That is the point — it is the
-- response — and it is why this table sits in `jobs` with no client grant,
-- beside the outbox rather than in `public`. Non-negotiable 8 is about logs and
-- analytics payloads; this is neither, and `jobs.carries_content` is
-- deliberately not applied to it.
-- ---------------------------------------------------------------------------
create table jobs.idempotent_requests (
  function_name text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  request_fingerprint bytea not null,
  status text not null default 'in_flight',
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (function_name, user_id, key),
  constraint idempotent_requests_function check (function_name ~ '^[a-z][a-z0-9-]{0,60}$'),
  constraint idempotent_requests_status check (status in ('in_flight', 'done')),
  constraint idempotent_requests_fingerprint_length check (octet_length(request_fingerprint) = 32),
  -- A finished request has an answer to give back; an unfinished one has
  -- nothing yet. A `case`, so a null does not pass.
  constraint idempotent_requests_shape check (
    case status
      when 'done' then completed_at is not null and response_status is not null
      else completed_at is null and response_status is null and response_body is null
    end
  )
);

comment on table jobs.idempotent_requests is
  'What a client already asked for and what it was told, so a retry is answered rather than repeated (§9.1). Service role only.';

-- ---------------------------------------------------------------------------
-- Rate counters.
--
-- Fixed windows, one row per (scope, key, window). Fixed rather than sliding
-- because the thing being bought is cheap and approximate: these are abuse
-- controls, not authorisation. Nothing a rate limit protects here is also
-- protected *only* by the rate limit — the invite must still be live, the
-- membership must still be a guest's, the cap still holds.
--
-- **The key is a digest, never the key itself.** The per-IP limit on redemption
-- (§14) would otherwise put an address in a table, and an address is a person.
-- SHA-256 of the value is enough to count with and not enough to read back.
-- ---------------------------------------------------------------------------
create table jobs.rate_counters (
  scope text not null,
  key_hash bytea not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (scope, key_hash, window_start),
  constraint rate_counters_scope check (scope ~ '^[a-z][a-z0-9_]{0,40}$'),
  constraint rate_counters_key_length check (octet_length(key_hash) = 32),
  constraint rate_counters_count check (count >= 0)
);

comment on table jobs.rate_counters is
  'Fixed-window counters for the Edge Functions'' abuse limits. Keys are SHA-256 digests: an IP address is a person, and this table never holds one.';

create index rate_counters_window_idx on jobs.rate_counters (window_start);

-- Supabase grants `all` on new tables in some schemas by default; `jobs` is
-- the service role's and the owner's, and these two are no exception.
revoke all on jobs.idempotent_requests from anon, authenticated;
revoke all on jobs.rate_counters from anon, authenticated;
grant select, insert, update, delete on jobs.idempotent_requests to service_role;
grant select, insert, update, delete on jobs.rate_counters to service_role;

alter table jobs.idempotent_requests enable row level security;
alter table jobs.rate_counters enable row level security;

-- No policies, deliberately: RLS with no policy is default-deny, and the
-- service role bypasses it. A client reaching either table reads nothing.

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/jobs/on_member_changed.sql
create or replace function jobs.on_member_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A join is a membership becoming active, not only a row appearing. A removed
  -- member who redeems a live link joins again (`redeem_invite`), and that is
  -- the same event to everybody downstream: the owner is told, the roster
  -- changes, the dispatcher counts a new non-responder. Emitting only on INSERT
  -- made the second join silent.
  --
  -- The INSERT arm now asks for `active` as well, which it never used to. An
  -- insert that lands `removed` is nobody joining; it was unreachable in
  -- practice, and a trigger that says "joined" for it is a trigger that will one
  -- day be right about nothing.
  if (tg_op = 'INSERT' and new.status = 'active')
    or (tg_op = 'UPDATE' and new.status = 'active' and old.status <> 'active') then
    perform jobs.emit('circles.member_joined', 'circle', new.circle_id, jsonb_build_object(
      'circle_id', new.circle_id,
      'user_id', new.user_id,
      'role', new.role
    ));
  elsif new.status = 'removed' and old.status <> 'removed' then
    perform jobs.emit('circles.member_removed', 'circle', new.circle_id, jsonb_build_object(
      'circle_id', new.circle_id,
      'user_id', new.user_id
    ));
  end if;
  return new;
end;
$$;

revoke all on function jobs.on_member_changed() from public;
revoke all on function jobs.on_member_changed() from anon, authenticated;

-- supabase/sql/functions/jobs/run_retention.sql
-- ---------------------------------------------------------------------------
-- Retention (§8.5, ADR 0005).
--
-- One function, one rule per statement, each returning what it deleted so the
-- run can be read afterwards. Runs as the owner: the service role holds no
-- delete on the two logs and cannot touch `auth.users`, and that is right —
-- an Edge Function with the power to purge is a bigger surface than a cron
-- job in the database.
--
-- Things this deliberately does not delete:
--   * suppressed contacts — the suppression list is the promise not to send
--     again, and it has to outlive the address it is about;
--   * analytics events — the record;
--   * plans, responses, confirmations — the product's history.
-- ---------------------------------------------------------------------------

create or replace function jobs.run_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_outbox integer;
  n_jobs integer;
  n_delivery integer;
  n_invites integer;
  n_tokens integer;
  n_pending_contacts integer;
  n_plan_contacts integer;
  n_summaries integer;
  n_summaries_purged integer;
  n_windows_aged integer;
  n_windows_gone integer;
  n_anonymous integer;
  n_requests integer;
  n_counters integer;
  n_audit integer;
  result jsonb;
begin
  -- Outbox and pipeline bookkeeping: 30 days. An unprocessed outbox row is
  -- never deleted, however old — the health job reports it instead.
  delete from jobs.outbox where processed_at < now() - interval '30 days';
  get diagnostics n_outbox = row_count;

  delete from jobs.notification_jobs where created_at < now() - interval '30 days';
  get diagnostics n_jobs = row_count;

  delete from private.email_delivery_events where recorded_at < now() - interval '30 days';
  get diagnostics n_delivery = row_count;

  -- Revoked invite hashes: 30 days.
  delete from public.circle_invites where revoked_at < now() - interval '30 days';
  get diagnostics n_invites = row_count;

  -- Expired or used tokens: 7 days after they stopped being usable.
  delete from private.email_action_tokens
  where expires_at < now() - interval '7 days'
     or used_at < now() - interval '7 days';
  get diagnostics n_tokens = row_count;

  -- Unverified contacts: 7 days. Somebody typed an address and never clicked
  -- the link; the address does not stay — unless a link they could still
  -- click exists, because a contact that asked for a fresh link yesterday is
  -- not one that gave up a week ago, and the cascade would take the link.
  delete from private.email_contacts c
  where c.status = 'pending'
    and c.created_at < now() - interval '7 days'
    and not exists (
      select 1 from private.email_action_tokens t
      where t.contact_id = c.id and t.used_at is null and t.expires_at > now()
    );
  get diagnostics n_pending_contacts = row_count;

  -- Verified plan-only contacts: 30 days after every plan they were subscribed
  -- to has finished. Every contact in the MVP is plan-only (spec §3: no
  -- marketing consent), so "plan-only" means "verified and not suppressed".
  -- A contact with a live subscription stays; one whose plans have all been
  -- completed, cancelled or expired for 30 days goes, address and all. A
  -- withdrawn subscription keeps nothing: the person said stop, and the
  -- address has no reason left to be here.
  delete from private.email_contacts c
  where c.status = 'verified'
    and not exists (
      select 1
      from private.email_subscriptions s
      join public.plans p on p.id = s.plan_id
      where s.contact_id = c.id
        and s.status = 'active'
        and (p.state not in ('completed', 'cancelled', 'expired')
             or p.updated_at > now() - interval '30 days')
    )
    and c.verified_at < now() - interval '30 days';
  get diagnostics n_plan_contacts = row_count;

  -- Willing windows, rule one (ADR 0005): 12 months, for members of active
  -- circles — after the summary is written, from everything still stored,
  -- so that what the member usually offers survives the windows going.
  -- Dropped first: two runs in one transaction (a test, a retry) would
  -- otherwise meet their own table.
  perform set_config('client_min_messages', 'warning', true);
  drop table if exists aged_responses;
  create temporary table aged_responses on commit drop as
    select r.id as response_id, p.circle_id, r.user_id
    from public.plan_responses r
    join public.plans p on p.id = r.plan_id
    join public.circles c on c.id = p.circle_id
    join public.circle_members m on m.circle_id = c.id and m.user_id = r.user_id
    where r.submitted_at < now() - interval '12 months'
      and c.status = 'active'
      and m.status = 'active'
      and exists (select 1 from public.willing_windows w where w.response_id = r.id);

  -- Added to what is already summarised, never recomputed from what is left:
  -- the windows that went last time are in the stored counts and nowhere else.
  insert into public.member_dayparts (circle_id, user_id, summary, computed_at)
  select g.circle_id, g.user_id,
    jobs.daypart_summary(jobs.add_daypart_counts(
      coalesce((select d.summary -> 'counts' from public.member_dayparts d
                where d.circle_id = g.circle_id and d.user_id = g.user_id), '{}'::jsonb),
      jobs.daypart_counts(g.response_ids)
    )),
    now()
  from (
    select a.circle_id, a.user_id, array_agg(a.response_id) as response_ids
    from aged_responses a group by a.circle_id, a.user_id
  ) g
  on conflict (circle_id, user_id) do update
    set summary = excluded.summary, computed_at = excluded.computed_at;
  get diagnostics n_summaries = row_count;

  delete from public.willing_windows w
  using aged_responses a
  where w.response_id = a.response_id;
  get diagnostics n_windows_aged = row_count;

  -- Willing windows, rule two: 30 days after removal or archiving. No summary
  -- — a removed member's pre-fill is nobody's to keep — and the summary that
  -- was written while they were a member goes with the windows.
  delete from public.member_dayparts d
  using public.circle_members m, public.circles c
  where m.circle_id = d.circle_id and m.user_id = d.user_id
    and c.id = d.circle_id
    and (
      (m.status = 'removed' and m.updated_at < now() - interval '30 days')
      or (c.status = 'archived' and c.updated_at < now() - interval '30 days')
    );
  get diagnostics n_summaries_purged = row_count;

  delete from public.willing_windows w
  using public.plan_responses r, public.plans p, public.circles c, public.circle_members m
  where w.response_id = r.id
    and p.id = r.plan_id
    and c.id = p.circle_id
    and m.circle_id = c.id and m.user_id = r.user_id
    and (
      (m.status = 'removed' and m.updated_at < now() - interval '30 days')
      or (c.status = 'archived' and c.updated_at < now() - interval '30 days')
    );
  get diagnostics n_windows_gone = row_count;

  -- Abandoned anonymous identities: a guest session that never joined
  -- anything, 30 days on. The cascade takes the profile.
  delete from auth.users u
  where coalesce(u.is_anonymous, false)
    and u.created_at < now() - interval '30 days'
    and not exists (select 1 from public.circle_members m where m.user_id = u.id);
  get diagnostics n_anonymous = row_count;

  -- The Edge Function kit's own bookkeeping (S1-13). Both of these are written
  -- on every request and read only by the request after it, so without a rule
  -- they are the two tables in the schema that grow forever.
  --
  -- Seven days for a served request, which is a retry window with a great deal
  -- of room in it: a client that has not retried inside a week is a client that
  -- has moved on, and the mutations themselves are idempotent by their own state
  -- anyway. An *unfinished* one is kept, however old — it means a function died
  -- between claiming a key and answering, and that is worth being able to find.
  delete from jobs.idempotent_requests
  where status = 'done' and completed_at < now() - interval '7 days';
  get diagnostics n_requests = row_count;

  -- A counter outside its own window can never be read again: `take_rate_token`
  -- computes `window_start` from the clock and only ever touches the current
  -- one. A day's grace, so that nothing is deleted while it is still counting.
  delete from jobs.rate_counters where window_start < now() - interval '1 day';
  get diagnostics n_counters = row_count;

  -- Audit log: 12 months.
  delete from private.audit_log where occurred_at < now() - interval '12 months';
  get diagnostics n_audit = row_count;

  result := jsonb_build_object(
    'outbox', n_outbox,
    'notification_jobs', n_jobs,
    'delivery_events', n_delivery,
    'revoked_invites', n_invites,
    -- Not "tokens": the key would trip the no-content check that guards the
    -- audit log, and rightly — a count of links is what this is.
    'expired_action_links', n_tokens,
    'pending_contacts', n_pending_contacts,
    'plan_only_contacts', n_plan_contacts,
    'daypart_summaries', n_summaries,
    'daypart_summaries_purged', n_summaries_purged,
    'windows_aged', n_windows_aged,
    'windows_of_the_gone', n_windows_gone,
    'anonymous_identities', n_anonymous,
    'served_requests', n_requests,
    'rate_counters', n_counters,
    'audit_rows', n_audit
  );

  -- The run is itself a fact worth keeping for a year: counts only.
  insert into private.audit_log (action, resource_type, metadata)
  values ('retention.ran', 'account', result);

  return result;
end;
$$;

comment on function jobs.run_retention() is
  'The daily retention rules of §8.5 and ADR 0005, one statement each; returns what each deleted. Runs as the owner from pg_cron.';

revoke all on function jobs.run_retention() from public;
revoke all on function jobs.run_retention() from anon, authenticated;
revoke all on function jobs.run_retention() from service_role;

-- supabase/sql/functions/private/move_membership.sql
-- ---------------------------------------------------------------------------
-- One membership, one circle, from one identity to another.
--
-- Both paths that move a membership use this: `reattach_member`, when a guest
-- comes back with no session (ADR 0006), and `claim_identity`, when somebody
-- saves their place and turns out to have had a permanent identity already.
-- One copy, because the cost of two is a table moved by one of them and left
-- behind by the other — and "left behind" means a guest who reattaches and
-- finds their answers gone.
--
-- It decides nothing. Who may move what is the caller's question: this assumes
-- it has already been answered and does the writing.
--
-- `member_dayparts` and any re-entry token for the membership are absent below
-- because they move themselves — both reference `circle_members` with
-- `on update cascade`, which 0006 and 0007 put there for this moment.
--
-- `analytics.events` is also deliberately absent, and it is the one table here
-- that *should* be: an event is a record of something that happened to an
-- identity at a time, and rewriting it would be rewriting history rather than
-- following a person. It has no foreign key to `auth.users`, so nothing
-- cascades it away either.
-- ---------------------------------------------------------------------------

create or replace function private.move_membership(
  p_circle_id uuid,
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact record;
  destination_contact uuid;
begin
  -- A re-entry token is a guest's way back in *without* signing in, which is why
  -- `enforce_reentry_for_guests` refuses to issue one against a saved place. When
  -- a membership becomes a saved-place member's, any token bound to it has to go
  -- for exactly that reason — and it has to go *first*, because
  -- `email_action_tokens.membership_user_id` follows `circle_members` by cascade
  -- and the trigger fires on that update, refusing the whole move.
  --
  -- Deleted rather than marked spent: the trigger watches every update of the
  -- column, so a spent row would be carried across and refused just the same.
  -- Nothing is lost — a token that matches no row is already `token_invalid`.
  if exists (select 1 from public.profiles p where p.user_id = p_to and p.is_permanent)
    or exists (
      select 1 from auth.users u where u.id = p_to and not coalesce(u.is_anonymous, false)
    )
  then
    delete from private.email_action_tokens t
    where t.purpose = 'reentry'
      and t.membership_circle_id = p_circle_id
      and t.membership_user_id = p_from;
  end if;

  -- The membership itself, first: the cascading references follow this write.
  update public.circle_members m
  set user_id = p_to
  where m.circle_id = p_circle_id and m.user_id = p_from;

  -- Everything else the member owns. Each of these references `auth.users`
  -- with no action on update, so each is moved by name — and
  -- `090_identity_continuity.sql` checks the list against the catalogue rather
  -- than trusting that it is complete.
  update public.plan_responses r set user_id = p_to
  where r.user_id = p_from
    and r.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.plan_participants pp set user_id = p_to
  where pp.user_id = p_from
    and pp.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.plan_required_members rm set user_id = p_to
  where rm.user_id = p_from
    and rm.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update public.attendance a set user_id = p_to
  where a.user_id = p_from
    and a.confirmation_id in (
      select c.id from public.meetup_confirmations c
      join public.plans p on p.id = c.plan_id
      where p.circle_id = p_circle_id
    );

  update public.nudge_states n set user_id = p_to
  where n.user_id = p_from
    and n.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  update private.plan_interest i set user_id = p_to
  where i.user_id = p_from
    and i.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  -- The availability snapshots name who could come, and `transition_plan` reads
  -- the candidate's array at confirm time to decide who is `going`. A stale id
  -- there is this person marked `unknown` at the one moment the product is
  -- about.
  update public.candidates c
  set available_user_ids = array_replace(c.available_user_ids, p_from, p_to)
  where p_from = any (c.available_user_ids)
    and c.candidate_set_id in (
      select cs.id from public.candidate_sets cs
      join public.plans p on p.id = cs.plan_id
      where p.circle_id = p_circle_id
    );

  update public.meetup_confirmations mc
  set available_user_ids = array_replace(mc.available_user_ids, p_from, p_to)
  where p_from = any (mc.available_user_ids)
    and mc.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);

  -- The member's own email contact, where one is tied to this circle. It has to
  -- come along: a re-entry token's `(contact_id, membership_user_id)` pair is
  -- checked against `email_contacts (id, user_id)` at commit, so a contact left
  -- behind fails the deferred constraint and takes the whole move with it.
  --
  -- **Merged, not moved**, when the destination already holds that address.
  -- Uniqueness is `(email_hash, user_id)` (0009), so moving would collide and
  -- roll back everything above it — and the architecture's table for
  -- `email_action_tokens` says so in as many words: "It must **merge** rather
  -- than move the *contact*". The case is ordinary rather than exotic: a guest
  -- asks for plan-update email at an address, then saves their place and turns
  -- out to have an account at the same address.
  for contact in
    select ec.id, ec.email_hash
    from private.email_contacts ec
    where ec.user_id = p_from
      and (
        exists (
          select 1 from private.email_subscriptions s
          join public.plans p on p.id = s.plan_id
          where s.contact_id = ec.id and p.circle_id = p_circle_id
        )
        or exists (
          select 1 from private.email_action_tokens t
          where t.contact_id = ec.id and t.membership_circle_id = p_circle_id
        )
      )
  loop
    select ec.id into destination_contact
    from private.email_contacts ec
    where ec.user_id = p_to and ec.email_hash = contact.email_hash;

    if found then
      -- Consent and any outstanding link are re-pointed at the contact the
      -- destination already owns, and the duplicate row goes. Its `status` is
      -- deliberately left alone: a pending contact stays pending, so nothing is
      -- ever sent to an address this identity has not verified — the safe
      -- direction, and the one the suppression rules assume.
      update private.email_subscriptions sub
      set contact_id = destination_contact, user_id = p_to
      where sub.contact_id = contact.id;

      update private.email_action_tokens tok
      set contact_id = destination_contact
      where tok.contact_id = contact.id;

      delete from private.email_contacts ec where ec.id = contact.id;
    else
      update private.email_contacts ec set user_id = p_to where ec.id = contact.id;
    end if;
  end loop;

  -- Queued mail for the person, not yet sent. A job left on the old identity is
  -- a message the dispatcher either sends to nobody or drops when retention
  -- takes the abandoned identity with it.
  update jobs.notification_jobs j set user_id = p_to
  where j.user_id = p_from
    and j.sent_at is null
    and j.plan_id in (select p.id from public.plans p where p.circle_id = p_circle_id);
end;
$$;

comment on function private.move_membership(uuid, uuid, uuid) is
  'Moves one circle membership and every row scoped to it from one identity to another. Shared by reattach_member and claim_identity; decides nothing.';

revoke all on function private.move_membership(uuid, uuid, uuid) from public;
revoke all on function private.move_membership(uuid, uuid, uuid) from anon, authenticated;

-- supabase/sql/functions/public/begin_request.sql
-- ---------------------------------------------------------------------------
-- Has this request already been served?
--
-- One round trip that both claims the key and answers the question, because two
-- — read, then insert — is the race it exists to close: the duplicate a retry
-- sends arrives while the first is still running, and both reads say "new".
-- `on conflict do nothing` makes the insert itself the claim.
--
-- Four answers, and the caller does something different with each:
--
--   `fresh`     nobody has this key; go and do the work.
--   `done`      served already; hand back the recorded response verbatim.
--   `in_flight` the first attempt has not finished; the honest answer is "not
--               yet", not a second attempt at the work.
--   `mismatch`  this key was used for a *different* body. Returning the first
--               body would be confidently wrong, so it is an error instead.
--
-- In `public` although everything it touches is in `jobs`: PostgREST exposes
-- `public` and nothing else, and `supabase/config.toml` is explicit that adding
-- a schema there "is a privacy decision". An Edge Function reaches this over
-- HTTP, so it has to be callable — and a `public` function granted to
-- `service_role` alone widens nothing, which `090_identity_continuity.sql`
-- asserts rather than assumes.
-- ---------------------------------------------------------------------------

create or replace function public.begin_request(
  p_function text,
  p_user uuid,
  p_key text,
  p_fingerprint bytea
)
returns table (state text, response_status integer, response_body jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jobs.idempotent_requests;
begin
  insert into jobs.idempotent_requests (function_name, user_id, key, request_fingerprint)
  values (p_function, p_user, p_key, p_fingerprint)
  on conflict (function_name, user_id, key) do nothing;

  if found then
    return query select 'fresh'::text, null::integer, null::jsonb;
    return;
  end if;

  select * into existing
  from jobs.idempotent_requests r
  where r.function_name = p_function and r.user_id = p_user and r.key = p_key;

  if existing.request_fingerprint <> p_fingerprint then
    return query select 'mismatch'::text, null::integer, null::jsonb;
  elsif existing.status = 'done' then
    return query select 'done'::text, existing.response_status, existing.response_body;
  else
    return query select 'in_flight'::text, null::integer, null::jsonb;
  end if;
end;
$$;

comment on function public.begin_request(text, uuid, text, bytea) is
  'Claims an idempotency key and says whether the request is fresh, already served, still running, or the same key with a different body.';

revoke all on function public.begin_request(text, uuid, text, bytea) from public;
revoke all on function public.begin_request(text, uuid, text, bytea) from anon, authenticated;
grant execute on function public.begin_request(text, uuid, text, bytea) to service_role;

-- supabase/sql/functions/public/claim_identity.sql
-- ---------------------------------------------------------------------------
-- claim_identity
--
-- Somebody saves their place (§10): `linkIdentity` with an email code, or
-- `signInWithIdToken` with Apple or Google, on top of the anonymous session
-- they have been using as a guest. Two different things can have just happened,
-- and the client cannot tell them apart on its own:
--
--   * the identity was new, so Supabase attached it to the anonymous user —
--     same user id, `is_anonymous` now false, nothing to merge; or
--   * the identity already existed, so Supabase signed them in *as that user*
--     and the anonymous one is now abandoned along with its memberships.
--
-- The second is the case §10 means by "`claim-identity` to reconcile
-- memberships if the permanent identity already existed".
--
-- **Granted to `service_role` and nothing else.** This is the one function of
-- the three whose authorisation cannot live in SQL: the claim being made is "I
-- was also this anonymous user", and the only proof of it is that session's
-- access token, which the caller no longer holds as `auth.uid()`. The Edge
-- Function verifies that token and then calls this. Were it callable by
-- `authenticated`, `p_anonymous_user_id` would be an unchecked parameter naming
-- somebody else's guest membership — which is to say, a way to take it. A
-- definer function granted to a client role must never take the identity it
-- acts on as an argument; this one takes two, so it is not granted to one.
--
-- Idempotent. Saying it twice moves nothing the first call did not move, and
-- the audit row keeps `growth.account_claimed` from being counted twice.
-- ---------------------------------------------------------------------------

create or replace function public.claim_identity(
  p_user_id uuid,
  p_anonymous_user_id uuid,
  p_moment text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  merged integer := 0;
  membership record;
begin
  if p_user_id is null or p_anonymous_user_id is null then
    raise exception 'claim_identity needs both identities'
      using errcode = 'null_value_not_allowed';
  end if;

  -- The moment is an enum in `packages/contracts/analytics.ts`, and the event
  -- this writes is validated against that catalogue downstream. Refusing here
  -- turns a payload the pipeline would drop into an error the caller can see.
  if p_moment is null or p_moment not in
    ('after_answer', 'after_confirmed', 'after_attendance', 'settings') then
    raise exception 'claim_identity got an unknown moment'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A saved place is what is being claimed, so the destination must have one.
  -- Without this check an anonymous caller could have its own profile marked
  -- permanent — which takes it off every Continue-as list and makes its
  -- membership unreattachable, locking somebody out of their own way back in
  -- without a sign-in anywhere in the story. Read from `auth.users`, which only
  -- the auth server writes.
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and not coalesce(u.is_anonymous, true)
  ) then
    raise exception 'destination_is_not_permanent' using errcode = 'insufficient_privilege';
  end if;

  -- The durable record of the saved place. `handle_user_updated` sets this when
  -- the auth row stops being anonymous, which covers the `linkIdentity` case;
  -- this covers the other one, where the permanent user existed already and its
  -- profile may predate the column.
  update public.profiles p set is_permanent = true
  where p.user_id = p_user_id and not p.is_permanent;

  if p_anonymous_user_id <> p_user_id then
    -- Never merge *from* a saved place. Both identities belonging to one person
    -- is the premise; two saved places is two accounts, and moving memberships
    -- between them on a client's word would be a way to take one. The anonymous
    -- side has nothing to lose and no sign-in to bypass, which is exactly why it
    -- is the only side this accepts.
    if exists (
      select 1 from auth.users u
      where u.id = p_anonymous_user_id and not coalesce(u.is_anonymous, false)
    ) or exists (
      select 1 from public.profiles p
      where p.user_id = p_anonymous_user_id and p.is_permanent
    ) then
      raise exception 'source_is_permanent' using errcode = 'insufficient_privilege';
    end if;

    for membership in
      select m.circle_id
      from public.circle_members m
      where m.user_id = p_anonymous_user_id and m.status = 'active'
      -- Locked in a fixed order: two claims racing for one pair of identities
      -- would otherwise deadlock against each other half way through.
      order by m.circle_id
      for update
    loop
      if exists (
        select 1 from public.circle_members m
        where m.circle_id = membership.circle_id and m.user_id = p_user_id
          and m.status = 'active'
      ) then
        -- Both identities are *active* in this circle. The saved place is the one
        -- that keeps working on another device, so it stays and the guest row
        -- goes. `on_member_removed` does the rest — the duplicate's answers, its
        -- place in the participant list, and its `going` on anything still ahead.
        update public.circle_members m
        set status = 'removed'
        where m.circle_id = membership.circle_id and m.user_id = p_anonymous_user_id;
      else
        -- `status = 'active'` above, and not merely "has a row", because the
        -- account may hold a membership of this circle that *ended*. Treating
        -- that as a collision removed the guest's live membership and
        -- `on_member_removed` deleted the availability they had just submitted —
        -- so saving your place cost you the circle, which is the opposite of
        -- "linking the existing guest membership. Nothing already sent changes"
        -- (spec §5.1).
        --
        -- The old row is the same person's, under the name they had then, and its
        -- answers are long gone. It is deleted to make room rather than revived:
        -- the membership that matters is the live one, and a primary key of
        -- `(circle_id, user_id)` has room for exactly one.
        delete from public.circle_members m
        where m.circle_id = membership.circle_id and m.user_id = p_user_id
          and m.status = 'removed';

        -- The name the circle knows them by travels with the membership rather
        -- than being replaced by the profile's. Nobody's roster entry should
        -- change because somebody else signed in.
        perform private.move_membership(membership.circle_id, p_anonymous_user_id, p_user_id);
        merged := merged + 1;
      end if;
    end loop;
  end if;

  -- Once per account, whatever the client retries. The audit log is the record
  -- rather than the outbox, because the outbox is drained and swept and this has
  -- to stay true for longer than that.
  if not exists (
    select 1 from private.audit_log a
    where a.action = 'growth.account_claimed' and a.resource_id = p_user_id
  ) then
    insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
    values (p_user_id, 'growth.account_claimed', 'account', p_user_id,
            jsonb_build_object('moment', p_moment, 'merged_memberships', merged));

    perform jobs.emit('growth.account_claimed', 'account', p_user_id,
      jsonb_build_object('user_id', p_user_id, 'moment', p_moment));
  end if;

  return merged;
end;
$$;

comment on function public.claim_identity(uuid, uuid, text) is
  'Reconciles an anonymous identity''s memberships onto a permanent one after sign-in (§10). Service role only: the anonymous identity is a parameter, and its proof is a token only the Edge Function can check.';

revoke all on function public.claim_identity(uuid, uuid, text) from public;
revoke all on function public.claim_identity(uuid, uuid, text) from anon, authenticated;
grant execute on function public.claim_identity(uuid, uuid, text) to service_role;

-- supabase/sql/functions/public/enforce_member_cap.sql
-- ---------------------------------------------------------------------------
-- The member cap, and the owner's membership.
--
-- Both are triggers rather than checks because both are statements about a
-- table, not about a row.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_member_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_count integer;
begin
  if new.status <> 'active' then
    return new;
  end if;

  -- `for update` on the circle serialises concurrent joins: two people
  -- redeeming the last seat at once would otherwise both count eleven.
  perform 1 from public.circles where id = new.circle_id for update;

  select count(*) into active_count
  from public.circle_members
  where circle_id = new.circle_id
    and status = 'active'
    and (tg_op = 'INSERT' or user_id <> new.user_id);

  if active_count >= public.member_cap() then
    raise exception 'circle % already has the maximum of % active members',
      new.circle_id, public.member_cap()
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_member_cap() is
  'Holds a circle to member_cap() active members (ADR 0012). A trigger rather than a check because the rule is about the table, not the row.';

revoke all on function public.enforce_member_cap() from public;
revoke all on function public.enforce_member_cap() from anon, authenticated;

-- supabase/sql/functions/public/finish_request.sql
-- The other half of `begin_request`: what the caller was told, so the retry can
-- be told the same thing. Writing nothing when the key is not claimed — rather
-- than inserting — keeps a response from being recorded against a request that
-- was never begun.
--
-- In `public` although everything it touches is in `jobs`: PostgREST exposes
-- `public` and nothing else, and `supabase/config.toml` is explicit that adding
-- a schema there "is a privacy decision". An Edge Function reaches this over
-- HTTP, so it has to be callable — and a `public` function granted to
-- `service_role` alone widens nothing, which `090_identity_continuity.sql`
-- asserts rather than assumes.

create or replace function public.finish_request(
  p_function text,
  p_user uuid,
  p_key text,
  p_status integer,
  p_body jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update jobs.idempotent_requests r
  set status = 'done',
      response_status = p_status,
      response_body = p_body,
      completed_at = now()
  where r.function_name = p_function
    and r.user_id = p_user
    and r.key = p_key
    and r.status = 'in_flight';
$$;

comment on function public.finish_request(text, uuid, text, integer, jsonb) is
  'Records the response an idempotent request produced, so a retry is answered rather than repeated.';

revoke all on function public.finish_request(text, uuid, text, integer, jsonb) from public;
revoke all on function public.finish_request(text, uuid, text, integer, jsonb) from anon, authenticated;
grant execute on function public.finish_request(text, uuid, text, integer, jsonb) to service_role;

-- supabase/sql/functions/public/guest_members_for_reattach.sql
-- ---------------------------------------------------------------------------
-- The "Continue as" list (spec §5.1, ADR 0006).
--
-- Somebody opens a circle or plan link with no session, or with a session that
-- holds no membership of that circle. To offer "Continue as Priya" the page
-- needs the circle's guest names — and nothing else. Display names only: no
-- reply state, no email flag, no join time. That is not a nicety, it is the
-- constraint ADR 0006 wrote down ("the continue-as list must never show reply
-- status or email presence"), because the list is shown before anybody has
-- proved they belong here.
--
-- Keyed by short code rather than circle id, like the link-preview route
-- (§9.4): the short code is what the person actually has.
--
-- Granted to `authenticated` only, which includes an anonymous session but not
-- the `anon` role. A visitor arriving with no session at all signs in
-- anonymously first — the client has to do that anyway before it can reattach,
-- so it costs the flow nothing.
--
-- That grant is **not** a volume control, and this comment used to claim it was:
-- "scraping costs one anonymous identity per attempt". It does not. One
-- anonymous session can call this as often as it likes with as many short codes
-- as it likes, and Supabase's per-IP signup limit never comes into it. So the
-- limit is here, in the function, where a client calling the RPC directly meets
-- it too: thirty lookups per caller per hour, which is far more than a person
-- opening a link will ever need and far less than a scrape.
--
-- Saved-place members are excluded, so the list never names somebody this
-- function could not then be used to reattach to.
-- ---------------------------------------------------------------------------

-- `volatile`, not `stable`, because counting a lookup is a write. The cost is a
-- function the planner cannot fold into a surrounding query; the benefit is that
-- the limit cannot be skipped by the one caller it is meant for.
create or replace function public.guest_members_for_reattach(p_short_code text)
returns table (member_user_id uuid, display_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'guest_members_for_reattach requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.take_rate_token(
    'roster_lookup', extensions.digest(caller::text, 'sha256'), 30, interval '1 hour'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  return query
  select m.user_id, m.display_name_snapshot
  from public.circle_members m
  join public.circles c on c.id = m.circle_id
  join public.profiles p on p.user_id = m.user_id
  join auth.users u on u.id = m.user_id
  where c.short_code = p_short_code
    and m.status = 'active'
    -- Two records of one fact, and the stricter reading wins. `profiles` is
    -- the durable record `handle_user_updated` maintains; `auth.users` is
    -- Supabase's own. A row where they disagree is a row this list must not
    -- name, whichever of the two is the stale one — "a saved-place member can
    -- never be reattached to" is a privacy invariant, not a preference.
    and not p.is_permanent
    and u.is_anonymous
  order by m.display_name_snapshot, m.user_id;
end;
$$;

comment on function public.guest_members_for_reattach(text) is
  'The Continue-as list: display names of a circle''s guest members, by short code. Never reply state, never email presence (ADR 0006).';

revoke all on function public.guest_members_for_reattach(text) from public;
revoke all on function public.guest_members_for_reattach(text) from anon, authenticated;
grant execute on function public.guest_members_for_reattach(text) to authenticated;

-- supabase/sql/functions/public/reattach_member.sql
-- ---------------------------------------------------------------------------
-- reattach_member
--
-- A guest comes back with no session — the expected path, not the rare one
-- (ADR 0006: Safari drops script-writable storage after seven idle days, and
-- chat in-app browsers isolate it). They sign in anonymously again, pick their
-- name from the Continue-as list or arrive on an emailed `/a/<token>` link, and
-- this moves the membership and everything scoped to it onto the new identity.
--
-- Two ways in, one path through. The list names the membership; the token
-- authorises it. Everything after resolution is identical, which is the point
-- ADR 0006 and §10 both make: "this reuses one reattachment path for both the
-- manual and the emailed case".
--
-- The safeguards are all here rather than in the Edge Function, because they
-- are the decision and not the throttle: the caller must be a guest, the target
-- must be a guest, and a membership may move at most three times in seven days.
-- "A reattachment moves a membership only within a circle the guest already
-- belongs to, never onto a saved-place member" is an AGENTS.md privacy
-- invariant, so it is enforced where it cannot be skipped.
--
-- **The old identity is not deleted here.** The ticket asked for that; three
-- things say otherwise. An anonymous identity can hold memberships in more than
-- one circle, and deleting it would cascade away the ones this reattachment did
-- not touch. `circles.owner_user_id`, `circle_invites.created_by` and
-- `plans.organiser_user_id` reference `auth.users` with no action, so a delete
-- can *fail* — turning a lost session into a guest who cannot get back in, at
-- the worst possible moment. And retention already owns this: `run_retention`
-- deletes anonymous identities with no memberships after thirty days
-- (ADR 0014, §8.5), which is precisely what this one becomes.
-- ---------------------------------------------------------------------------

create or replace function public.reattach_member(
  p_circle_id uuid default null,
  p_target_user_id uuid default null,
  p_reentry_token_hash bytea default null
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_circle uuid := p_circle_id;
  target uuid := p_target_user_id;
  token private.email_action_tokens;
  chosen public.circles;
  moves integer;
  -- `member_reattached`'s analytics payload is `source: 'list' | 'email'`
  -- (packages/contracts/src/analytics.ts), and the reattach rate by source is
  -- what tells us whether the emailed path is worth its machinery. The function
  -- is the only place that knows which one happened.
  entry_source text := case when p_reentry_token_hash is null then 'list' else 'email' end;
begin
  if caller is null then
    raise exception 'reattach_member requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- A saved-place identity does not reattach: it signs in. §10 — "if the
  -- membership belongs to a permanent identity, the page offers that identity's
  -- sign-in instead".
  --
  -- Three records of the same fact, and the strictest wins, which is the rule
  -- this function already applies to the *target* and had no business not
  -- applying to the caller. `auth_is_permanent()` reads the JWT, and a JWT
  -- outlives the event it describes: `linkIdentity` converts the user in place,
  -- so an access token issued minutes earlier keeps `is_anonymous: true` for the
  -- rest of its hour (§14) while `auth.users` and `profiles` have already moved
  -- on. For that hour the stale token was enough to take a *second* guest
  -- membership and attach it to a saved place, where Continue-as can never move
  -- it again.
  if public.auth_is_permanent()
    or exists (select 1 from public.profiles p where p.user_id = caller and p.is_permanent)
    or exists (
      select 1 from auth.users u where u.id = caller and not coalesce(u.is_anonymous, true)
    )
  then
    raise exception 'caller_is_permanent' using errcode = 'insufficient_privilege';
  end if;

  if (p_reentry_token_hash is null) = (target is null) then
    raise exception 'reattach_member takes a target membership or a re-entry token, not both and not neither'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_reentry_token_hash is not null then
    -- Single-use, 7-day, bound to a membership (§14). Spent whether or not the
    -- rest succeeds is wrong — so it is spent here, inside the same
    -- transaction, and a later failure rolls the spend back with it.
    select * into token
    from private.email_action_tokens t
    where t.token_hash = p_reentry_token_hash
      and t.purpose = 'reentry'
      and t.used_at is null
      and t.expires_at > now();

    if not found then
      raise exception 'token_invalid' using errcode = 'no_data_found';
    end if;

    target_circle := token.membership_circle_id;
    target := token.membership_user_id;

    update private.email_action_tokens t set used_at = now() where t.id = token.id;
  end if;

  -- Serialises two reattachments of the same membership: without it both read
  -- a chain of two and both decide they are the third.
  select * into chosen from public.circles c where c.id = target_circle for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  if target = caller then
    -- Already theirs. A retry, or the link opened twice: the answer is the
    -- circle, and no second row in the audit log spending the allowance.
    return chosen;
  end if;

  if not exists (
    select 1 from public.circle_members m
    where m.circle_id = target_circle and m.user_id = target and m.status = 'active'
  ) then
    raise exception 'member_not_found' using errcode = 'no_data_found';
  end if;

  -- Never onto a saved-place member. Both records are read, and the stricter
  -- wins, for the reason `guest_members_for_reattach` reads both: whichever of
  -- them is stale, the answer has to be no.
  if exists (
    select 1 from public.profiles p where p.user_id = target and p.is_permanent
  ) or not exists (
    select 1 from auth.users u where u.id = target and coalesce(u.is_anonymous, false)
  ) then
    raise exception 'target_is_permanent' using errcode = 'insufficient_privilege';
  end if;

  -- The caller already belongs here under their own name. Moving a second
  -- membership onto them would collide with their own row, and the thing they
  -- actually want is the session they are already holding.
  if exists (
    select 1 from public.circle_members m
    where m.circle_id = target_circle and m.user_id = caller
  ) then
    raise exception 'already_member' using errcode = 'unique_violation';
  end if;

  -- Three per membership per seven days (ADR 0006). Counting is not a simple
  -- `where user_id = target`: every reattachment *changes* the membership's
  -- user id, so the previous ones are recorded against identities this one has
  -- never seen. The audit rows form a chain — each names the identity it moved
  -- from and the one it moved to — and the membership's history is the walk
  -- backwards along it.
  --
  -- `union`, not `union all`, and the row's own id in the result — because the
  -- chain can be a *cycle*. A membership moves A→B, and later, from the session
  -- on device A that is still valid, B→A. The history then loops A→B→A→B, and
  -- `union all` follows it until the statement is cancelled or the server runs
  -- out of memory. `union` discards a row already in the result, so revisiting
  -- the same audit row ends the recursion; carrying the id keeps two genuinely
  -- separate moves between the same pair of identities counted as two.
  with recursive chain (id, from_id, to_id) as (
    select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id'
    from private.audit_log a
    where a.action = 'circles.member_reattached'
      and a.resource_id = target_circle
      and a.occurred_at > now() - interval '7 days'
      and a.metadata ->> 'to_user_id' = target::text
    union
    select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id'
    from private.audit_log a
    join chain on a.metadata ->> 'to_user_id' = chain.from_id
    where a.action = 'circles.member_reattached'
      and a.resource_id = target_circle
      and a.occurred_at > now() - interval '7 days'
  )
  select count(*) into moves from chain;

  if moves >= 3 then
    raise exception 'reattach_limit' using errcode = 'too_many_rows';
  end if;

  -- The move itself lives in `private.move_membership`, shared with
  -- `claim_identity`: one list of the tables a membership owns, because two
  -- lists means one of them forgets a table and a guest comes back to find
  -- their answers gone.
  perform private.move_membership(target_circle, target, caller);

  -- Ids only (non-negotiable 8). The two ids are what makes the chain above
  -- walkable; a display name here would be the leak the constraint on this
  -- table refuses anyway.
  insert into private.audit_log (actor_user_id, action, resource_type, resource_id, metadata)
  values (caller, 'circles.member_reattached', 'circle', target_circle,
          jsonb_build_object('from_user_id', target, 'to_user_id', caller));

  -- The owner's "Priya rejoined from a new device" (spec §5.1) starts here.
  -- No name: the notification pipeline reads the roster for that.
  perform jobs.emit('circles.member_reattached', 'circle', target_circle,
    jsonb_build_object('circle_id', target_circle, 'user_id', caller, 'source', entry_source));

  return chosen;
end;
$$;

comment on function public.reattach_member(uuid, uuid, bytea) is
  'Moves a guest membership and everything scoped to it onto the calling anonymous identity, from the Continue-as list or an emailed re-entry token (ADR 0006). At most three per membership per seven days; never onto a saved-place member.';

revoke all on function public.reattach_member(uuid, uuid, bytea) from public;
revoke all on function public.reattach_member(uuid, uuid, bytea) from anon, authenticated;
grant execute on function public.reattach_member(uuid, uuid, bytea) to authenticated;

-- supabase/sql/functions/public/redeem_invite.sql
-- ---------------------------------------------------------------------------
-- redeem_invite
--
-- The only way a membership is created from an invite link (§9.1). A definer
-- function rather than an insert policy, for the reason `create_circle` is
-- one: joining is several writes that have to be one — the membership, the use
-- count, and two checks that are only true if nobody else joins between them.
--
-- **The secret never arrives here.** The Edge Function hashes the link
-- fragment with SHA-256 and passes the digest, so the capability itself is
-- never a statement parameter and cannot reach a query log (§14: tokens are
-- "never logged"). The digest finds the invite; the row it finds is the
-- authority.
--
-- What this function enforces cannot be bypassed by calling it directly: the
-- invite must be live, the cap holds, the name must be free, and the membership
-- lands on `auth.uid()` rather than on anything the caller says. Turnstile and
-- the per-IP limit live in the Edge Function because they are abuse controls
-- rather than authorisation — skipping them lets somebody make more requests,
-- not make a request the database would have refused.
--
-- Idempotent by its own state rather than by a key column: being an active
-- member of the circle *is* the record that this already happened, so a retry
-- returns the circle and writes nothing. (`create_circle` carries a
-- `creation_key` because a circle has no such natural record — asking twice
-- would leave two circles and no way to tell which link was shared.)
-- ---------------------------------------------------------------------------

create or replace function public.redeem_invite(
  p_secret_hash bytea,
  p_display_name text
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  invite public.circle_invites;
  target public.circles;
  existing public.circle_members;
  violated text;
begin
  if caller is null then
    raise exception 'redeem_invite requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  -- `invite_inactive` is one error for three causes — no such secret, revoked,
  -- or a circle that has since gone — because the caller is not entitled to
  -- know which. The LinkInvalid screen says the same thing to all three.
  select * into invite
  from public.circle_invites i
  where i.secret_hash = p_secret_hash and i.revoked_at is null;

  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  -- Serialises concurrent joins. `enforce_member_cap` takes the same lock, and
  -- taking it here too means the duplicate-name check and the cap see one
  -- roster rather than two.
  select * into target from public.circles c where c.id = invite.circle_id for update;
  if not found then
    raise exception 'invite_inactive' using errcode = 'no_data_found';
  end if;

  select * into existing
  from public.circle_members m
  where m.circle_id = target.id and m.user_id = caller;

  if found and existing.status = 'active' then
    -- Already in. A retry, a second tap, or the link opened twice in one
    -- browser: nothing to do, and in particular no second use counted.
    return target;
  end if;

  -- The cap, checked here for the *message* rather than for the rule. The rule
  -- is `enforce_member_cap`, which fires on the write below whoever makes it;
  -- this reads the same count under the same circle lock, so it cannot give a
  -- different answer, and it lets the caller be told `circle_full` instead of
  -- a trigger's exception text — which names the circle and the cap.
  if (
    select count(*) from public.circle_members m
    where m.circle_id = target.id and m.status = 'active' and m.user_id <> caller
  ) >= public.member_cap() then
    raise exception 'circle_full' using errcode = 'check_violation';
  end if;

  -- A removed member redeeming a live link joins again. Removal and link
  -- rotation are separate tools in spec §5.2 — "the owner can remove a member
  -- **and** reset the link" — and the link is the capability. Rejoining runs
  -- the cap and the name check again, and `on_member_changed` announces it, so
  -- the owner sees it happen rather than finding out later.
  if found then
    update public.circle_members m
    set status = 'active', display_name_snapshot = p_display_name
    where m.circle_id = target.id and m.user_id = caller;
  else
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values (target.id, caller, p_display_name);
  end if;

  update public.circle_invites i
  set use_count = i.use_count + 1
  where i.id = invite.id;

  return target;

exception
  when unique_violation then
    -- Which unique index, not "a unique index". `circle_members_active_name_idx`
    -- is the name rule; the primary key is the same caller arriving twice at
    -- once from two tabs, which is a retry and not a name collision. Reporting
    -- the second as `duplicate_name` would send the client to ask for a new
    -- name it does not need.
    get stacked diagnostics violated = constraint_name;
    if violated = 'circle_members_active_name_idx' then
      -- The name check is the index rather than a read-then-write, because two
      -- people joining at once is exactly when a read-then-write loses: the
      -- second reads a roster that does not yet hold the first. The client's
      -- answer is to ask for another name (spec §9).
      raise exception 'duplicate_name' using errcode = 'unique_violation';
    end if;
    raise;
  when check_violation then
    -- `circle_members_name_length` is on the *canonical* form, which strips
    -- combining marks — so a name of nothing but marks passes the request schema
    -- (the domain normalises whitespace, not marks) and fails here. Named rather
    -- than caught wholesale, so that the member cap and every other check keep
    -- their own answers.
    get stacked diagnostics violated = constraint_name;
    if violated = 'circle_members_name_length' then
      raise exception 'display_name_unusable' using errcode = 'check_violation';
    end if;
    raise;
end;
$$;

comment on function public.redeem_invite(bytea, text) is
  'Joins the caller to the circle behind an invite digest. Idempotent on an existing active membership; raises invite_inactive, duplicate_name or circle_full.';

revoke all on function public.redeem_invite(bytea, text) from public;
revoke all on function public.redeem_invite(bytea, text) from anon, authenticated;
grant execute on function public.redeem_invite(bytea, text) to authenticated;

-- supabase/sql/functions/public/release_request.sql
-- ---------------------------------------------------------------------------
-- The claim, given back.
--
-- `begin_request` writes an `in_flight` row before the work starts, so that a
-- duplicate arriving mid-flight is told "not yet" rather than doing the work a
-- second time. If the work then *fails*, that row is a lie: nothing was served,
-- and the key now answers `in_flight` to every retry for as long as the row
-- lives — which retention deliberately makes forever, because an unfinished row
-- is evidence a function died.
--
-- The first version of this kit had no such function, and the hole it left was
-- the one ADR 0016 exists to close: a client that asked once, was refused for a
-- duplicate name, and asked again with a new name got `idempotency_mismatch`,
-- and with the same name got `in_progress`. Either way it could never ask again.
--
-- Only an unfinished claim is released. A `done` row is an answer somebody has
-- been given and must keep being given.
-- ---------------------------------------------------------------------------

create or replace function public.release_request(
  p_function text,
  p_user uuid,
  p_key text
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from jobs.idempotent_requests r
  where r.function_name = p_function
    and r.user_id = p_user
    and r.key = p_key
    and r.status = 'in_flight';
$$;

comment on function public.release_request(text, uuid, text) is
  'Gives back an unfinished idempotency claim so a failed request can be retried. Never touches a served one.';

revoke all on function public.release_request(text, uuid, text) from public;
revoke all on function public.release_request(text, uuid, text) from anon, authenticated;
grant execute on function public.release_request(text, uuid, text) to service_role;

-- supabase/sql/functions/public/take_rate_token.sql
-- ---------------------------------------------------------------------------
-- One fixed window, one counter, one answer: may this happen?
--
-- The window is derived from the clock rather than stored, so there is no
-- bookkeeping to get wrong and no row to expire before it is read: every caller
-- in the same window computes the same `window_start` and lands on the same row.
--
-- Counting happens whether or not the answer is yes. A refused attempt is still
-- an attempt, and a limiter that only counts successes is one that can be held
-- open indefinitely by failing.
--
-- In `public` although everything it touches is in `jobs`: PostgREST exposes
-- `public` and nothing else, and `supabase/config.toml` is explicit that adding
-- a schema there "is a privacy decision". An Edge Function reaches this over
-- HTTP, so it has to be callable — and a `public` function granted to
-- `service_role` alone widens nothing, which `090_identity_continuity.sql`
-- asserts rather than assumes.
-- ---------------------------------------------------------------------------

create or replace function public.take_rate_token(
  p_scope text,
  p_key_hash bytea,
  p_limit integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  seconds double precision := extract(epoch from p_window);
  bucket_start timestamptz;
  taken integer;
begin
  if p_limit < 1 or seconds <= 0 then
    raise exception 'take_rate_token needs a positive limit and window'
      using errcode = 'invalid_parameter_value';
  end if;

  bucket_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / seconds) * seconds);

  insert into jobs.rate_counters (scope, key_hash, window_start, count)
  values (p_scope, p_key_hash, bucket_start, 1)
  on conflict (scope, key_hash, window_start)
    do update set count = jobs.rate_counters.count + 1
  returning count into taken;

  return taken <= p_limit;
end;
$$;

comment on function public.take_rate_token(text, bytea, integer, interval) is
  'Counts one attempt in the current fixed window and says whether it is within the limit. Counts refusals too.';

revoke all on function public.take_rate_token(text, bytea, integer, interval) from public;
revoke all on function public.take_rate_token(text, bytea, integer, interval) from anon, authenticated;
grant execute on function public.take_rate_token(text, bytea, integer, interval) to service_role;

-- END GENERATED: function definitions

-- ---------------------------------------------------------------------------
-- 0022 — "Emails about plans you organise" (SUS-83, ADR 0029).
--
-- An organiser with no app is emailed options ready, replies closed, did it
-- happen and the about-time nudge (spec §5.8, review C6), and until now had no
-- way to stop any of them but to bounce. The founder's decision is that they
-- turn it off in the app, where they are signed in, rather than by a link.
--
--   * `profiles.muted_organiser_email` — the person's own switch. On the
--     profile rather than a membership because the letters go to an identity's
--     own address and follow it across every circle it organises in. Which
--     kinds it stops is the domain's (`organiserEmailSwitch` on the kinds
--     table): options ready and did it happen. Replies closed still sends.
--   * `public.dispatch_context` carries it on each member row, so
--     `recipientsFor` leaves the organiser out when email was their channel.
--   * `public.dispatch_claim_due` carries it on each due job, so a letter
--     queued before the switch was turned off — did it happen is written at
--     confirmation and sent the next morning — is skipped rather than sent.
--
-- Never a suppression and never a deleted contact (ADR 0027): the contact is
-- long-lived on purpose, and a suppression is permanent and address-wide.
--
-- A new migration rather than a regenerated `0021`, which has shipped;
-- `MIGRATION` in `scripts/gen-sql-functions.mjs` now points here.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column muted_organiser_email boolean not null default false;

comment on column public.profiles.muted_organiser_email is
  'This person has turned "Emails about plans you organise" off on notification settings (ADR 0029). Stops the email version of options_ready and did_it_happen; never push, never plan-update email, never replies_closed. Read by the dispatcher at enqueue and again at send.';

-- The person's own switch, like `display_name` and `time_zone`:
-- `profiles_update_own` limits the row to their own; this limits the column.
grant update (muted_organiser_email) on public.profiles to authenticated;

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/dispatch_claim_due.sql
-- ---------------------------------------------------------------------------
-- The email jobs that are due, with the one address each is for.
--
-- Everything a send needs and nothing it does not. Three of the fields are
-- here because S1-18 found that the job alone is not enough to decide whether
-- to send it:
--
--   * `contact_status` — a suppression that lands after the job was written
--     leaves the job `scheduled`. "Permanent failure → skipped" (spec §9) is
--     evaluated when you send, not when the job was made.
--   * `subscribed` — and so is the consent. A `reminder` is written the moment
--     a meetup is confirmed and sits there for days; "Stop emails for this
--     meetup" withdraws the subscription and touches no job, so without this
--     the stop link would stop nothing that was already queued. It is
--     `private.email_recipients_for`, which is the one place the join is
--     written (S1-18), asked again at the moment of sending.
--   * `plan_state` — a verification queued while a plan was live is still
--     `scheduled` after the plan is cancelled, and sending it is a letter
--     about a meetup that is over.
--   * `circle_archived` — "Archiving stops all prompts" (spec §5.2), and a
--     reminder written before the owner archived is still `scheduled` after.
--     Asked at the moment of sending, so bringing the circle back lets what
--     was queued go rather than losing it (S1-23).
--   * `organiser_email_muted` — the contact's owner has turned "Emails about
--     plans you organise" off (ADR 0029). `did_it_happen` is written when a
--     meetup is confirmed and sent the next morning, so a switch read only
--     when the job was written would not stop the letter it was turned off
--     for. Which kinds it stops is the domain's (`organiserEmailStopped`);
--     this says only whether it is off.
--   * `superseded` — "one copy per event" is the sender's job, not the
--     writer's. One address can be held by two contacts since 0009: two
--     siblings subscribed to the same decided plan, or a guest who joined
--     twice, produce two jobs for one mailbox. The flag marks a job whose
--     letter has **already gone** to that address.
--
--     Only `sent`, and that is the whole correction. It used to mark a job
--     whose sibling was merely `scheduled` and sorted earlier — which suppressed
--     the eligible copy when the earlier one turned out not to be: the first
--     was skipped for having left the circle, the second was skipped as a
--     duplicate of it, and the mailbox got nothing at all (review round 3).
--     A copy cannot be a duplicate of one that was never sent, so the
--     within-a-batch half of the rule belongs after eligibility, in the sender,
--     where it is keyed on the address a letter actually went to.
--
-- The dedupe is by `(kind, plan, revision, address)` and is applied only to
-- the kinds whose occurrence is *determined* by the plan revision —
-- `locked_in`, `cancelled`, `reminder`, `did_it_happen_participant`, and the
-- organiser kinds, which have one contact anyway. `changed` and `verify_email`
-- are excluded on purpose: both can legitimately occur twice in one revision
-- (a second material change, a second verification request), they are keyed by
-- change id and verification id for exactly that reason, and deduping them by
-- address is how nobody gets told the venue moved. `about_time` (Slice 2,
-- SUS-52) is excluded for a third reason: it belongs to a circle and has no
-- plan at all, so every one of them matches every other on
-- `plan_id is not distinct from null` and an address would receive exactly
-- one cadence nudge, ever. The sender holds the same three in
-- `NEVER_COLLAPSED`, because the rule has a half on each side of the wire;
-- they had drifted by one kind when review round 4 looked.
--
-- Push is not claimed here. Slice 1 writes no push job — a kind whose only
-- channel is push finds no device and produces no recipient — and Slice 3
-- (SUS-59) adds the Expo half with its own receipts.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_claim_due(p_limit integer default 50)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with due as (
    select j.*
    from jobs.notification_jobs j
    where j.status = 'scheduled'
      and j.channel = 'email'
      and j.scheduled_for <= now()
    order by j.scheduled_for, j.created_at, j.id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id,
    'kind', j.kind,
    'contact_id', j.contact_id,
    'user_id', c.user_id,
    'plan_id', j.plan_id,
    'plan_revision', j.plan_revision,
    'idempotency_key', j.idempotency_key,
    'attempt_count', j.attempt_count,
    'email', c.email_normalized,
    'contact_status', c.status,
    'subscribed', exists (
      select 1 from private.email_recipients_for(j.plan_id) r where r.contact_id = j.contact_id
    ),
    -- `email_recipients_for` answers one question with three conditions in it,
    -- and the sender has to tell them apart: somebody who was removed from the
    -- circle withdrew nothing, and recording `subscription_withdrawn` against
    -- them tells whoever reads `last_error` the wrong story (review round 2).
    'member_active', exists (
      select 1 from public.circle_members m
      where m.circle_id = p.circle_id and m.user_id = c.user_id and m.status = 'active'
    ),
    'plan_state', p.state,
    'plan_short_code', p.short_code,
    'plan_current_revision', p.revision,
    'circle_id', p.circle_id,
    'circle_name', cir.name,
    'circle_archived', coalesce(cir.status = 'archived', false),
    'organiser_email_muted', coalesce((
      select pr.muted_organiser_email from public.profiles pr where pr.user_id = c.user_id
    ), false),
    'superseded', j.kind not in ('changed', 'verify_email', 'about_time') and exists (
      select 1
      from jobs.notification_jobs o
      join private.email_contacts oc on oc.id = o.contact_id
      where o.id <> j.id
        and o.kind = j.kind
        and o.plan_id is not distinct from j.plan_id
        and o.plan_revision is not distinct from j.plan_revision
        and oc.email_hash = c.email_hash
        and o.status = 'sent'
    )
  ) order by j.scheduled_for, j.created_at, j.id), '[]'::jsonb)
  from due j
  join private.email_contacts c on c.id = j.contact_id
  left join public.plans p on p.id = j.plan_id
  left join public.circles cir on cir.id = p.circle_id;
$$;

comment on function public.dispatch_claim_due(integer) is
  'The due email jobs, each with its address, the contact''s status now, the plan''s state now, whether its owner has turned organiser email off, and whether an earlier job already covers this address for this event. Service role only (S1-20).';

revoke all on function public.dispatch_claim_due(integer) from public;
revoke all on function public.dispatch_claim_due(integer) from anon, authenticated;
grant execute on function public.dispatch_claim_due(integer) to service_role;

-- supabase/sql/functions/public/dispatch_context.sql
-- ---------------------------------------------------------------------------
-- Everything the dispatcher needs to decide who hears about a plan, read once.
--
-- The rules themselves are `packages/domain/communication`'s and stay there
-- (non-negotiable 2): `recipientsFor` is a pure function of state, which is
-- what makes "a reminder to somebody who said they cannot come" testable
-- without Resend. This is the state. It is one statement for the reason
-- `public.engine_input` is one statement — an eligibility decision taken from
-- a roster read at one moment and answers read at another is a decision about
-- a circle that never existed.
--
-- What it deliberately does **not** carry: the initiator of a quiet ask (read
-- `private.plan_initiators` only where a kind needs it, and never into a job),
-- any email address (ids only; the address is read once, by the sender, from
-- `dispatch_claim_due`), and anyone's availability windows (eligibility needs
-- statuses, never times).
--
-- Names and titles *are* here, because the templates render them. This value
-- goes to the service role and to nowhere else: never to the outbox, never to
-- `analytics`, never to a log line (non-negotiable 8).
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_context(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'circle', to_jsonb(c) - 'created_at' - 'updated_at' - 'creation_key',
    'plan', to_jsonb(p) - 'created_at' - 'updated_at',
    'organiser_name', (
      select m.display_name_snapshot from public.circle_members m
      where m.circle_id = p.circle_id and m.user_id = p.organiser_user_id
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'circle_id', m.circle_id, 'user_id', m.user_id, 'display_name', m.display_name_snapshot,
        'role', m.role, 'status', m.status, 'joined_at', m.joined_at,
        'muted_quiet_asks', m.muted_quiet_asks, 'muted_all', m.muted_all,
        'time_zone', coalesce(pr.time_zone, c.time_zone),
        'is_permanent', coalesce(pr.is_permanent, false),
        -- "Emails about plans you organise" (ADR 0029): a person's, not a
        -- membership's, carried on the member row because that is where the
        -- dispatcher looks a person up. `mutedOrganiserEmail` reads it.
        'muted_organiser_email', coalesce(pr.muted_organiser_email, false)
      ) order by m.joined_at, m.user_id)
      from public.circle_members m
      left join public.profiles pr on pr.user_id = m.user_id
      where m.circle_id = p.circle_id
    ), '[]'::jsonb),
    'participant_ids', coalesce((
      select jsonb_agg(pp.user_id order by pp.user_id) from public.plan_participants pp
      where pp.plan_id = p.id and pp.revision = p.revision
    ), '[]'::jsonb),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', r.plan_id, 'revision', r.revision, 'user_id', r.user_id, 'status', r.status
      ) order by r.user_id)
      from public.plan_responses r
      where r.plan_id = p.id and r.revision = p.revision
    ), '[]'::jsonb),
    -- The live confirmation for the revision this plan is on, and the one a
    -- reopen or a cancellation just superseded. `changed` needs the second:
    -- "the time we had is off" is a sentence about a start that is no longer
    -- on the plan.
    'confirmation', (
      select to_jsonb(mc) - 'created_at' - 'updated_at'
      from public.meetup_confirmations mc
      where mc.plan_id = p.id and mc.status = 'active'
      order by mc.confirmed_at desc limit 1
    ),
    'superseded_confirmation', (
      select to_jsonb(mc) - 'created_at' - 'updated_at'
      from public.meetup_confirmations mc
      where mc.plan_id = p.id and mc.status <> 'active'
      order by mc.superseded_at desc nulls last, mc.confirmed_at desc limit 1
    ),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'confirmation_id', a.confirmation_id, 'user_id', a.user_id, 'status', a.status
      ) order by a.user_id)
      from public.attendance a
      join public.meetup_confirmations mc on mc.id = a.confirmation_id
      where mc.plan_id = p.id
    ), '[]'::jsonb),
    -- Verified contact, active subscription, active member — the join that
    -- `hasPlanEmailSubscription` actually means, written once in S1-18 and not
    -- worked out again here.
    'email_recipients', coalesce((
      select jsonb_agg(jsonb_build_object('contact_id', e.contact_id, 'user_id', e.user_id))
      from private.email_recipients_for(p.id) e
    ), '[]'::jsonb),
    'push_user_ids', coalesce((
      select jsonb_agg(distinct d.user_id) from private.push_devices d
      join public.circle_members m on m.user_id = d.user_id and m.circle_id = p.circle_id
      where d.enabled
    ), '[]'::jsonb),
    -- The top eligible option of the set that matches where the plan is now,
    -- for `options_ready`. A stale set is no answer: the organiser would be
    -- told about a time somebody has since said they cannot make.
    'best_candidate', (
      select jsonb_build_object(
        'starts_at', cd.starts_at, 'available_count', cardinality(cd.available_user_ids))
      from public.candidate_sets cs
      join public.candidates cd on cd.candidate_set_id = cs.id
      where cs.plan_id = p.id and cs.revision = p.revision and cs.input_version = p.input_version
        and not cd.is_near_miss
      order by cd.rank limit 1
    ),
    -- "At most one deadline reminder per member per plan" spans revisions, so
    -- it cannot come from the idempotency key: an edit bumps the revision and
    -- the key alone would re-remind everybody. `EligibilityContext.alreadySent`.
    'already_reminded', coalesce((
      select jsonb_agg(distinct coalesce(j.user_id, ec.user_id))
      from jobs.notification_jobs j
      left join private.email_contacts ec on ec.id = j.contact_id
      where j.plan_id = p.id and j.kind = 'deadline_approaching'
    ), '[]'::jsonb)
  )
  from public.plans p
  join public.circles c on c.id = p.circle_id
  where p.id = p_plan_id;
$$;

comment on function public.dispatch_context(uuid) is
  'One plan''s circle, roster (with each member''s organiser-email switch), participants, answers, confirmations, attendance, email recipients and top candidate, read together, for the dispatcher''s eligibility rules. Ids and display names; never an address, a token or an availability window. Service role only (S1-20).';

revoke all on function public.dispatch_context(uuid) from public;
revoke all on function public.dispatch_context(uuid) from anon, authenticated;
grant execute on function public.dispatch_context(uuid) to service_role;

-- END GENERATED: function definitions

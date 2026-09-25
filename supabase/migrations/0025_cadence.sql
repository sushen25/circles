-- ---------------------------------------------------------------------------
-- 0025 — Cadence nudges (S2-04, ADR 00XX).
--
-- "About time for the next one": when a circle falls due, one person is asked
-- to plan the next meetup, by the circle's nudge policy (spec §5.9). Most of
-- the pipeline already existed — `about_time` is an organiser kind, its
-- occurrence is the circle and the due date, the email is drawn — and what was
-- missing was a way for a job to belong to a circle with no plan, and a sweep
-- that finds the circles that are due.
--
--   * `jobs.notification_jobs.circle_id` — the circle a job belongs to when
--     there is no plan to find it through. `about_time` carries it and no
--     plan; every other kind leaves it null and is found through its plan.
--     `public.dispatch_claim_due` reads the circle through either, so
--     "archiving stops all prompts" (spec §5.2) reaches a queued nudge, which
--     it could not before (S1-23 review round 4).
--   * `private.cadence_prompts` — one row per circle per due date: the
--     decision that it has been prompted, and to whom. This is the ticket's
--     `circles.cadence_prompted_for`, made a table for two reasons. The
--     idempotency key is per recipient, so it cannot stop a second person
--     being asked for the same due date; and jobs are deleted after thirty
--     days (`jobs.run_retention`), which a two-monthly circle outlives while
--     still due. A row here outlives both. It also names who was asked, which
--     circle home needs for "it's your turn" (`public.my_turn_to_plan`), and
--     it is private because who was asked is nobody else's business.
--   * An index for the sweep: active circles with a goal and a history, by
--     `last_met_at`, which is what `dispatch_timed_work` orders them by.
--   * Functions: `dispatch_circle_context` (the circle's side of the rule),
--     `dispatch_prompt_cadence` (the decision and its jobs, once),
--     `dispatch_timed_work` (the sweep), `dispatch_enqueue` (takes a circle),
--     `dispatch_claim_due` (finds a nudge's circle), `dispatch_context`
--     (carries `muted_nudges`, which nothing read until now) and
--     `my_turn_to_plan`.
--
-- The ticket's `circle_members.muted_nudges` exists since 0021, and its
-- `circles.last_organiser_user_id` is not added: whoever organised the last
-- meetup that happened is read from that meetup's plan, which cannot drift
-- from it the way a copied column can.
--
-- `MIGRATION` in `scripts/gen-sql-functions.mjs` now points here; 0024 has
-- shipped.
-- ---------------------------------------------------------------------------

alter table jobs.notification_jobs
  add column circle_id uuid references public.circles (id) on delete cascade;

comment on column jobs.notification_jobs.circle_id is
  'The circle a job belongs to when it has no plan: about_time, the cadence nudge (S2-04). Null for every plan kind, whose circle is its plan''s.';

-- A circle's kind names its circle and no plan; a plan's kind names its plan
-- and leaves the circle to it. Written as a `case` so that a null in the
-- wrong column is a refusal, as `notification_jobs_recipient` is. There are no
-- `about_time` rows to check: nothing wrote one before this migration.
alter table jobs.notification_jobs
  add constraint notification_jobs_circle_kind check (
    case kind
      when 'about_time' then circle_id is not null and plan_id is null and plan_revision is null
      else circle_id is null
    end
  );

create index notification_jobs_circle_idx on jobs.notification_jobs (circle_id)
  where circle_id is not null;

create table private.cadence_prompts (
  circle_id uuid not null references public.circles (id) on delete cascade,
  -- The circle-local date the circle fell due on — `nudgeDueDate` in the
  -- domain, and the second half of `about_time`'s occurrence.
  due_date date not null,
  -- Who was asked. Null when the rule found nobody — everyone said no, or the
  -- one person the policy names did — which is a decision too, and is kept so
  -- the sweep does not ask again every minute. Set null, not cascaded, when
  -- the account goes: the due date stays decided.
  user_id uuid references auth.users (id) on delete set null,
  -- `NudgeRole`: why that person. Null with nobody.
  recipient_role text,
  prompted_at timestamptz not null default now(),
  primary key (circle_id, due_date),
  constraint cadence_prompts_role check (
    recipient_role is null
    or recipient_role in ('owner', 'last_organiser', 'take_turns', 'owner_fallback')
  )
);

comment on table private.cadence_prompts is
  'One row per circle per due date: that the cadence nudge for it has been decided, and whom it asked (null for nobody). Written only by public.dispatch_prompt_cadence; never visible to a client (S2-04).';

alter table private.cadence_prompts enable row level security;

create index circles_cadence_due_idx on public.circles (last_met_at)
  where status = 'active' and cadence <> 'none' and last_met_at is not null;

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/dispatch_circle_context.sql
-- ---------------------------------------------------------------------------
-- Everything the cadence nudge needs to decide who hears, for one circle, read
-- once (S2-04).
--
-- `public.dispatch_context` takes a plan, and `about_time` is the one kind that
-- belongs to a circle with no plan at all — so this is its context, beside the
-- plan one and in the same shape where they overlap. The decision itself is
-- the domain's (`nudgeDueDate`, `nudgeChoice`); this is the state, read in one
-- statement for the reason that one is: a recipient chosen from a roster read
-- at one moment and a meetup read at another is a choice about a circle that
-- never existed.
--
--   * `members` is **every** row of the circle, removed ones included. Take
--     turns walks on from the last organiser's place in join order, and
--     somebody who organised last and has since left still has one. The rule
--     asks only active members; the filters are the domain's.
--   * `has_open_plan` — a plan asking (`seeking`, `collecting`, `ready`) or
--     locked in (`confirmed`). A confirmed plan whose evening has passed and
--     whose outcome nobody has reported counts too: the circle may well have
--     just met, and `last_met_at` does not know it yet.
--   * `last_happened` — the last meetup reported as happened: its organiser,
--     and who was there. "Who was there" is everyone who said **I was there**,
--     or, when nobody has, everyone who was **going** — the organiser said it
--     happened, and an uncorroborated meetup is still the best record of who
--     came (spec §5.10).
--   * `prompted_for` — the latest due date already decided, from
--     `private.cadence_prompts`. The domain's due date is compared with it:
--     one nudge per due date.
--
-- No address, no token, no note. Display names are here because the member
-- rows carry them for the dispatcher's other callers; nothing in the nudge
-- renders one but the circle's. Service role only, like its sibling.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_circle_context(p_circle_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with last_happened as (
    select mc.id as confirmation_id, coalesce(p.organiser_user_id, mc.confirmed_by) as organiser
    from public.outcome_reports o
    join public.meetup_confirmations mc on mc.id = o.confirmation_id
    join public.plans p on p.id = mc.plan_id
    where p.circle_id = p_circle_id and o.outcome = 'happened'
    order by mc.starts_at desc, o.reported_at desc
    limit 1
  )
  select jsonb_build_object(
    'circle', to_jsonb(c) - 'created_at' - 'updated_at' - 'creation_key',
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'circle_id', m.circle_id, 'user_id', m.user_id, 'display_name', m.display_name_snapshot,
        'role', m.role, 'status', m.status, 'joined_at', m.joined_at,
        'muted_quiet_asks', m.muted_quiet_asks, 'muted_all', m.muted_all,
        'muted_nudges', m.muted_nudges,
        'time_zone', coalesce(pr.time_zone, c.time_zone),
        'is_permanent', coalesce(pr.is_permanent, false),
        'muted_organiser_email', coalesce(pr.muted_organiser_email, false)
      ) order by m.joined_at, m.user_id)
      from public.circle_members m
      left join public.profiles pr on pr.user_id = m.user_id
      where m.circle_id = c.id
    ), '[]'::jsonb),
    'has_open_plan', exists (
      select 1 from public.plans p
      where p.circle_id = c.id and p.state in ('seeking', 'collecting', 'ready', 'confirmed')
    ),
    'last_organiser_id', (select lh.organiser from last_happened lh),
    'last_happened_attendees', coalesce((
      select jsonb_agg(a.user_id order by a.user_id)
      from public.attendance a
      join last_happened lh on lh.confirmation_id = a.confirmation_id
      where a.status = 'was_there'
         or (a.status = 'going' and not exists (
           select 1 from public.attendance w
           where w.confirmation_id = lh.confirmation_id and w.status = 'was_there'
         ))
    ), '[]'::jsonb),
    'prompted_for', (
      select max(cp.due_date) from private.cadence_prompts cp where cp.circle_id = c.id
    ),
    'push_user_ids', coalesce((
      select jsonb_agg(distinct d.user_id) from private.push_devices d
      join public.circle_members m on m.user_id = d.user_id and m.circle_id = c.id
      where d.enabled
    ), '[]'::jsonb)
  )
  from public.circles c
  where c.id = p_circle_id;
$$;

comment on function public.dispatch_circle_context(uuid) is
  'One circle''s state for the cadence nudge: the circle, every membership row (with its nudge switch), whether a plan is open, the last happened meetup''s organiser and attendees, and the latest due date already prompted. Ids and display names; never an address or a token. Service role only (S2-04).';

revoke all on function public.dispatch_circle_context(uuid) from public;
revoke all on function public.dispatch_circle_context(uuid) from anon, authenticated;
grant execute on function public.dispatch_circle_context(uuid) to service_role;

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
--     was queued go rather than losing it (S1-23). The circle is the plan's,
--     or — for `about_time`, which has no plan — the job's own `circle_id`
--     (S2-04). Found through the plan alone, a cadence nudge's circle was
--     always null and archiving never stopped one.
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
      where m.circle_id = cir.id and m.user_id = c.user_id and m.status = 'active'
    ),
    'plan_state', p.state,
    'plan_short_code', p.short_code,
    'plan_current_revision', p.revision,
    'circle_id', cir.id,
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
  left join public.circles cir on cir.id = coalesce(p.circle_id, j.circle_id);
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
        -- "Nudges to plan the next one" (S2-04). Only the cadence nudge reads
        -- it, and that has its own context; carried here too so that one row
        -- shape serves both, and the domain's `Member` is whole in each.
        'muted_nudges', m.muted_nudges,
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

-- supabase/sql/functions/public/dispatch_enqueue.sql
-- ---------------------------------------------------------------------------
-- The jobs one event turned into, written in one statement.
--
-- `on conflict (idempotency_key) do nothing` is the whole of "delivery is
-- idempotent per recipient, plan revision, kind and occurrence" (spec §5.8).
-- A drain that crashes between enqueueing and marking the event processed runs
-- again and writes nothing new; a duplicate key is "already scheduled", not an
-- error (S1-11).
--
-- The count returned is of rows actually inserted, so a drain can say in its
-- log how much of what it computed was new — a number, not a recipient.
--
-- `circle_id` is the circle a job belongs to when there is no plan to find it
-- through: `about_time` alone (S2-04), which the table's own check holds to
-- carrying a circle and no plan. A plan's jobs leave it null and are found
-- through the plan, as they always were.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_enqueue(p_jobs jsonb)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with wanted as (
    select * from jsonb_to_recordset(coalesce(p_jobs, '[]'::jsonb)) as j (
      channel text,
      kind text,
      user_id uuid,
      contact_id uuid,
      plan_id uuid,
      plan_revision integer,
      circle_id uuid,
      scheduled_for timestamptz,
      idempotency_key text
    )
  ), written as (
    insert into jobs.notification_jobs (
      channel, kind, user_id, contact_id, plan_id, plan_revision, circle_id, scheduled_for,
      idempotency_key
    )
    select w.channel, w.kind, w.user_id, w.contact_id, w.plan_id, w.plan_revision, w.circle_id,
      w.scheduled_for, w.idempotency_key
    from wanted w
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*)::integer from written;
$$;

comment on function public.dispatch_enqueue(jsonb) is
  'Inserts notification jobs, ignoring any whose idempotency key already exists, and answers how many were new. Service role only (S1-20).';

revoke all on function public.dispatch_enqueue(jsonb) from public;
revoke all on function public.dispatch_enqueue(jsonb) from anon, authenticated;
grant execute on function public.dispatch_enqueue(jsonb) to service_role;

-- supabase/sql/functions/public/dispatch_prompt_cadence.sql
-- ---------------------------------------------------------------------------
-- A cadence nudge, decided: the record that this circle's due date has been
-- prompted, and the jobs that carry it, in one transaction (S2-04).
--
-- **One per due date, whoever it goes to.** The idempotency key cannot say
-- that on its own: it is per recipient, so a second pass that chose somebody
-- else — the first person turned nudges off in between — would write a second
-- job with a second key, and two people would each be told it is their turn.
-- And the key does not last: `jobs.run_retention` deletes jobs after thirty
-- days, and a two-monthly circle stays due for longer than that. So the
-- decision is its own row, `private.cadence_prompts`, keyed on the circle and
-- the due date, and a job is written only by the pass that wrote that row.
--
-- **Nobody is a decision too.** `p_user_id` is null when the rule found
-- nobody to ask — everyone said no, or the one person the policy names did —
-- and the row is written anyway, so the sweep does not ask the same question
-- every minute until somebody changes a switch (ADR 00XX).
--
-- **A plan made meanwhile wins.** The circle row is locked first — the lock
-- `planning.transition_plan` takes before it lets a plan open (ADR 0033) — and
-- the open-plan test is asked again under it. A plan that opened between the
-- sweep's read and this call is seen here and nothing is written; one that
-- opens after waits for this commit, and the sender asks again at send time.
--
-- Answers how many jobs were written, or null when this due date had already
-- been decided (or a plan is now open), so the caller records its analytics
-- event only for a decision that is new.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_prompt_cadence(
  p_circle_id uuid,
  p_due_date date,
  p_user_id uuid,
  p_recipient_role text,
  p_jobs jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  decided integer;
begin
  perform 1 from public.circles c where c.id = p_circle_id for update;
  if not found then
    return null;
  end if;

  if exists (
    select 1 from public.plans p
    where p.circle_id = p_circle_id and p.state in ('seeking', 'collecting', 'ready', 'confirmed')
  ) then
    return null;
  end if;

  insert into private.cadence_prompts (circle_id, due_date, user_id, recipient_role)
  values (p_circle_id, p_due_date, p_user_id, p_recipient_role)
  on conflict (circle_id, due_date) do nothing;
  get diagnostics decided = row_count;
  if decided = 0 then
    return null;
  end if;

  -- Every job carries this circle and no plan: the check on the table says
  -- so, and a job for another circle is refused rather than quietly written.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) j
    where (j ->> 'circle_id')::uuid is distinct from p_circle_id
       or j ->> 'kind' is distinct from 'about_time'
  ) then
    raise exception 'dispatch_prompt_cadence: jobs must be this circle''s about_time'
      using errcode = 'check_violation';
  end if;

  return public.dispatch_enqueue(p_jobs);
end;
$$;

comment on function public.dispatch_prompt_cadence(uuid, date, uuid, text, jsonb) is
  'Records that a circle''s due date has been prompted (to one person, or to nobody) and writes the about_time jobs that carry it, once per due date, under the circle lock; null when already decided or a plan is open. Service role only (S2-04).';

revoke all on function public.dispatch_prompt_cadence(uuid, date, uuid, text, jsonb) from public;
revoke all on function public.dispatch_prompt_cadence(uuid, date, uuid, text, jsonb)
  from anon, authenticated;
grant execute on function public.dispatch_prompt_cadence(uuid, date, uuid, text, jsonb)
  to service_role;

-- supabase/sql/functions/public/dispatch_timed_work.sql
-- ---------------------------------------------------------------------------
-- The work a clock creates, discovered from data rather than from a timer
-- (architecture §9.3).
--
-- Five things, every run, all of them queries:
--
-- 1. **A deadline that has passed.** Nothing emits `planning.deadline_passed`
--    — it is not a transition, and S1-11 left it for the sweep to raise. It is
--    emitted into the outbox rather than turned into a job here, so that the
--    one place events become notifications stays the drain. Once per
--    **deadline**, not once per plan: "give it one more day" (spec §5.7) moves
--    the deadline out and it passes again, and a marker keyed on the plan
--    would announce the second one to nobody. The outbox is still the marker,
--    which holds because a plan cannot outlive its own window by the thirty
--    days retention keeps events for (rule 2 below closes it long before).
--
-- 2. **A plan whose last possible start has gone.** Spec §9: "the plan stays
--    decidable until the last candidate start, then expires." The last start
--    is `public.plan_last_possible_start` — the same function the deadline
--    constraint uses, so the moment a plan stops being decidable and the
--    moment it may no longer be answered are one definition rather than two.
--    `expire` has no guards, so the actor is null: nobody did this, the window
--    closed.
--
-- 3. **A plan whose candidate set is stale.** After ADR 0018 every answer
--    recalculates in the request that caused it, and the cases with no request
--    to attach to are this function's: a member removed by a trigger, a
--    recalculation that lost its compare-and-set. Found by asking which plans
--    have no `candidate_sets` row at the version they are on (S1-16).
--
-- 4. **A deadline 24 hours out.** The plans, not the people: who is owed a
--    reminder is `recipientsFor('deadline_approaching')`'s answer and belongs
--    in the domain.
--
-- 5. **A circle that may be due a nudge** (S2-04). The circles, not the
--    decision: whether one is owed, for which due date and to whom is
--    `nudgeDueDate` and `nudgeChoice`'s, in the domain. This is a coarse
--    superset of the circles that could be owed one, so the domain is asked
--    about few circles rather than all of them: active, with a goal and a
--    history, nothing open, not snoozed, not already decided for a due date
--    after the last meetup — and met long enough ago that the lead window can
--    have opened. That last bound is the cadence less its lead days less one
--    more day, so no circle the domain would call due is ever left out by a
--    zone or a clock change; one it would not is merely asked about and told
--    no. Oldest first, so a circle that has waited longest is asked first.
--
-- Each transition is attempted on its own and a refusal is counted rather than
-- thrown: a plan that was confirmed between the select and the update is a
-- race with a correct outcome, and losing it must not abandon the rest of the
-- batch.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_timed_work(p_limit integer default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  batch integer := greatest(1, least(coalesce(p_limit, 50), 200));
  target record;
  closed integer := 0;
  expired integer := 0;
  refused integer := 0;
begin
  for target in
    select p.id, p.circle_id, p.revision, p.response_deadline
    from public.plans p
    where p.state in ('collecting', 'ready')
      and p.response_deadline <= now()
      and not exists (
        select 1 from jobs.outbox o
        where o.event_name = 'planning.deadline_passed'
          and o.aggregate_id = p.id
          and (o.payload ->> 'deadline')::timestamptz = p.response_deadline
      )
    order by p.response_deadline
    limit batch
  loop
    perform jobs.emit('planning.deadline_passed', 'plan', target.id, jsonb_build_object(
      'plan_id', target.id, 'circle_id', target.circle_id, 'revision', target.revision,
      -- The marker, and the reason it is in the payload rather than implied by
      -- the row: spec §5.7's replies-closed screen offers "give it one more
      -- day", and an extended deadline passes a second time. Keyed on the plan
      -- alone, the second one is announced to nobody — and the organiser's only
      -- channel in Slice 1 is this letter. An instant is an allowed payload
      -- value: `jobs.carries_content` takes `[A-Za-z0-9_./:+-]` up to 40, and
      -- this is 32.
      --
      -- **To the microsecond, and rendered rather than cast.** The first
      -- version of this used `OF:00` and lost the fraction, so the comparison
      -- below — which is at full precision — never matched a marker it had
      -- written itself, and every plan with a fractional deadline was
      -- announced again every minute for as long as it stayed open. Almost
      -- every deadline is fractional: `defaultDeadline` is `now + 1h`. Found
      -- in review round 2, and it is why the round-2 test runs the sweep twice
      -- against one deadline rather than once against two.
      --
      -- Rendered in UTC with an explicit offset rather than left to jsonb's
      -- own cast, which would use the session's `TimeZone` and make the stored
      -- string depend on who called.
      'deadline', to_char(target.response_deadline at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')));
    closed := closed + 1;
  end loop;

  for target in
    select p.id
    from public.plans p
    where p.state in ('collecting', 'ready')
      and public.plan_last_possible_start(
            p.window_end, p.daily_end_local, p.duration_minutes, p.time_zone) <= now()
    order by p.window_end
    limit batch
  loop
    begin
      perform planning.transition_plan(target.id, 'expire', null);
      expired := expired + 1;
    exception when others then
      refused := refused + 1;
    end;
  end loop;

  return jsonb_build_object(
    'deadline_passed', closed,
    'expired', expired,
    'expire_refused', refused,
    'stale', coalesce((
      select jsonb_agg(x.id) from (
        select p.id
        from public.plans p
        where p.state in ('collecting', 'ready')
          and not exists (
            select 1 from public.candidate_sets cs
            where cs.plan_id = p.id
              and cs.revision = p.revision
              and cs.input_version = p.input_version
          )
        order by p.updated_at
        limit least(batch, 20)
      ) x
    ), '[]'::jsonb),
    'approaching', coalesce((
      select jsonb_agg(x.id) from (
        select p.id
        from public.plans p
        where p.state in ('collecting', 'ready')
          and p.response_deadline > now()
          and p.response_deadline <= now() + interval '24 hours'
        order by p.response_deadline
        limit batch
      ) x
    ), '[]'::jsonb),
    'cadence', coalesce((
      select jsonb_agg(x.id) from (
        select c.id
        from public.circles c
        where c.status = 'active'
          and c.cadence <> 'none'
          and c.last_met_at is not null
          and c.last_met_at <= now() - case c.cadence
            when 'weekly' then interval '4 days'
            when 'fortnightly' then interval '11 days'
            when 'monthly' then interval '1 month' - interval '8 days'
            else interval '2 months' - interval '8 days'
          end
          and (c.cadence_snoozed_until is null or c.cadence_snoozed_until <= now())
          and not exists (
            select 1 from public.plans p
            where p.circle_id = c.id
              and p.state in ('seeking', 'collecting', 'ready', 'confirmed')
          )
          and not exists (
            select 1 from private.cadence_prompts cp
            where cp.circle_id = c.id
              and cp.due_date > (c.last_met_at at time zone c.time_zone)::date
          )
        order by c.last_met_at
        limit batch
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.dispatch_timed_work(integer) is
  'One pass of the time-based work: emits planning.deadline_passed once per plan, expires plans whose last possible start has gone, and names the plans with a stale candidate set or a deadline within 24 hours, and the circles that may be due a cadence nudge. Service role only (S1-20, S2-04).';

revoke all on function public.dispatch_timed_work(integer) from public;
revoke all on function public.dispatch_timed_work(integer) from anon, authenticated;
grant execute on function public.dispatch_timed_work(integer) to service_role;

-- supabase/sql/functions/public/my_turn_to_plan.sql
-- ---------------------------------------------------------------------------
-- Whether the caller is the one person this circle's cadence nudge asked
-- (S2-04).
--
-- Circle home shows **About time for the next one** to every member, and the
-- nudged one alone sees "it's your turn" in it (spec §5.9: one person is
-- nudged). Answered here rather than worked out on the client, because the
-- choice was made once, by the dispatcher, from switches the client cannot
-- all see — and a second calculation that disagreed would tell two people it
-- was their turn. The recipient is read from `private.cadence_prompts`, which
-- no client can select: the answer is about the caller, and only yes or no.
--
-- "This circle's nudge" is the one decided for a due date after the last
-- meetup — an older prompt belongs to a cycle the circle has since met in —
-- and it stops being the caller's when they turn nudges off: somebody who
-- said no is not then told it is their turn.
--
-- The caller's own, from `auth.uid()`, and false for anybody who is not an
-- active member: the question has no answer for them, and false says nothing.
-- ---------------------------------------------------------------------------

create or replace function public.my_turn_to_plan(p_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select true
    from public.circles c
    join public.circle_members m
      on m.circle_id = c.id and m.user_id = (select auth.uid()) and m.status = 'active'
    join private.cadence_prompts cp on cp.circle_id = c.id and cp.user_id = m.user_id
    where c.id = p_circle_id
      and c.status = 'active'
      and c.last_met_at is not null
      and cp.due_date > (c.last_met_at at time zone c.time_zone)::date
      and not m.muted_nudges
      and not m.muted_all
    limit 1
  ), false);
$$;

comment on function public.my_turn_to_plan(uuid) is
  'True when the caller, an active member, is the person this circle''s current cadence nudge asked and has not turned nudges off since. Only yes or no; never who else was asked (S2-04).';

revoke all on function public.my_turn_to_plan(uuid) from public;
revoke all on function public.my_turn_to_plan(uuid) from anon, authenticated;
grant execute on function public.my_turn_to_plan(uuid) to authenticated;

-- END GENERATED: function definitions

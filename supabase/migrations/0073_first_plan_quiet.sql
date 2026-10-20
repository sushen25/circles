-- 0073_first_plan_quiet
--
-- A first plan nobody has answered in 48 hours (SUS-240, parts 3 and 4): the
-- organiser's one optional question on the waiting screen, and the founder's
-- one "want a hand?" letter.
--
--   * `nudge_states` accepts a new moment, `first_plan_stalled`. It names a
--     plan like every moment but the gate and the source question, and the row
--     says only that the question was shown: the answer is an analytics event
--     (`first_plan_stalled`, one of three words) and joins nothing to a person.
--   * `jobs.notification_jobs` accepts a new kind, `first_plan_quiet`. It is a
--     plan's job, like `replies_closed`, so `notification_jobs_circle_kind`
--     (which holds a circle-only job to `about_time`) is unchanged.
--   * `private.first_plan_quiet_letters`: one row per circle, ever. The cap on
--     the letter is state, because the idempotency key is per plan and the
--     jobs table is cleaned after thirty days (ADR 0085).
--   * `dispatch_first_plan_quiet_candidates` and `dispatch_first_plan_quiet`
--     (generated below): which first plans may be owed the letter, and the
--     decision that writes the row and the job together.
--   * `stop_letters` (generated below) skips a queued `first_plan_quiet` when
--     the organiser stop link is tapped, as it does the other organiser letters.

alter table public.nudge_states
  drop constraint nudge_states_moment;

alter table public.nudge_states
  add constraint nudge_states_moment check (moment in (
    'after_attendance_start_circle', 'email_given_app', 'first_plan_stalled', 'locked_in_app',
    'organiser_gate', 'organiser_source', 'reattached_save_place', 'reattached_twice_app',
    'second_response_app', 'sent_save_access'
  ));

comment on column public.nudge_states.moment is
  'NUDGE_MOMENTS in packages/domain/src/growth. Every moment but organiser_gate and organiser_source names a plan.';

alter table jobs.notification_jobs
  drop constraint notification_jobs_kind,
  add constraint notification_jobs_kind check (kind in (
    'new_plan', 'quiet_ask', 'threshold_initiator', 'threshold_keen', 'deadline_approaching',
    'options_ready', 'replies_closed', 'locked_in', 'changed', 'cancelled', 'reminder',
    'did_it_happen', 'about_time', 'did_it_happen_participant', 'verify_email',
    'quiet_expired', 'asked_again', 'moved', 'first_plan_quiet'
  ));

create table private.first_plan_quiet_letters (
  circle_id uuid primary key references public.circles (id) on delete cascade,
  -- The first plan the decision was made about. Kept for the record, not read.
  plan_id uuid references public.plans (id) on delete set null,
  decided_at timestamptz not null default now()
);

comment on table private.first_plan_quiet_letters is
  'One row per circle, ever: that the founder''s first_plan_quiet letter has been decided for it (sent, or not wanted). The cap on that letter. Written only by public.dispatch_first_plan_quiet; never visible to a client (SUS-240, ADR 0085).';

alter table private.first_plan_quiet_letters enable row level security;

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/dispatch_first_plan_quiet.sql
-- ---------------------------------------------------------------------------
-- The founder's "want a hand?" letter, decided: the record that this circle
-- has been sent it, and the job that carries it, in one transaction
-- (SUS-240, ADR 0085).
--
-- **Once per circle, ever.** The idempotency key cannot say that on its own:
-- it is per recipient, plan and revision, so a second stalled plan in the same
-- circle would have a key of its own. And the jobs table is cleaned after
-- thirty days. So the cap is its own row, `private.first_plan_quiet_letters`,
-- keyed on the circle, and a job is written only by the call that wrote that
-- row. The row is written even when there is no job (`p_jobs` empty: the
-- organiser has organiser letters off, or no address we may write to), so a
-- letter that was not wanted at 48 hours is not sent at 60 because a switch
-- changed: it was decided once.
--
-- **The facts are asked again under the lock.** The circle row is locked first
-- (the lock `planning.transition_plan` takes), then the plan must still be its
-- circle's first named plan, still asking, with no answer from anyone but its
-- organiser. Anything else writes nothing and answers null, so the caller
-- records nothing: somebody answered between the sweep's read and this call.
--
-- Answers how many jobs were written, or null when nothing was decided.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_first_plan_quiet(p_plan_id uuid, p_jobs jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_circle uuid;
  v_organiser uuid;
  decided integer;
begin
  -- Every job is this plan's first_plan_quiet: refused rather than quietly
  -- written, whatever else holds.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) j
    where (j ->> 'plan_id')::uuid is distinct from p_plan_id
       or j ->> 'kind' is distinct from 'first_plan_quiet'
  ) then
    raise exception 'dispatch_first_plan_quiet: jobs must be this plan''s first_plan_quiet'
      using errcode = 'check_violation';
  end if;

  select p.circle_id into v_circle from public.plans p where p.id = p_plan_id;
  if v_circle is null then
    return null;
  end if;

  perform 1 from public.circles c where c.id = v_circle for update;

  select p.organiser_user_id into v_organiser
  from public.plans p
  where p.id = p_plan_id
    and p.mode = 'named'
    and p.state in ('collecting', 'ready')
    and p.id = (
      select f.id from public.plans f
      where f.circle_id = p.circle_id and f.mode = 'named'
      order by f.created_at, f.id
      limit 1
    );
  if v_organiser is null then
    return null;
  end if;

  if exists (
    select 1 from public.plan_responses r
    where r.plan_id = p_plan_id and r.user_id is distinct from v_organiser
  ) then
    return null;
  end if;

  insert into private.first_plan_quiet_letters (circle_id, plan_id)
  values (v_circle, p_plan_id)
  on conflict (circle_id) do nothing;
  get diagnostics decided = row_count;
  if decided = 0 then
    return null;
  end if;

  return public.dispatch_enqueue(p_jobs);
end;
$$;

comment on function public.dispatch_first_plan_quiet(uuid, jsonb) is
  'Records that a circle has been sent the founder''s first_plan_quiet letter (or decided not to), once per circle ever, and writes the job that carries it, under the circle lock; null when the plan is no longer the circle''s first asking plan, someone else has answered it, or the circle was decided already. Service role only (SUS-240, ADR 0085).';

revoke all on function public.dispatch_first_plan_quiet(uuid, jsonb) from public;
revoke all on function public.dispatch_first_plan_quiet(uuid, jsonb) from anon, authenticated;
grant execute on function public.dispatch_first_plan_quiet(uuid, jsonb) to service_role;

-- supabase/sql/functions/public/dispatch_first_plan_quiet_candidates.sql
-- ---------------------------------------------------------------------------
-- The first plans that may be owed the founder's "want a hand?" letter
-- (SUS-240, ADR 0085).
--
-- A coarse superset, as `dispatch_timed_work` is for the cadence nudge: the
-- circles' **first named plan**, still asking, made at least 48 hours ago, in
-- an active circle that has never been sent the letter (no row in
-- `private.first_plan_quiet_letters`), with an organiser. Each comes with the
-- facts the domain's rule needs (`firstPlanQuiet`) and nothing else: when it
-- was made, in epoch milliseconds, and how many people other than its organiser
-- have answered it on any revision. Whether the letter is owed, to whom and
-- when is the domain's and the dispatcher's. No name, address or plan code.
--
-- Oldest first, so a plan that has waited longest is looked at first.
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_first_plan_quiet_candidates(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'plan_id', x.id,
    'created_ms', x.created_ms
  ) order by x.created_at, x.id), '[]'::jsonb)
  from (
    select
      p.id,
      p.created_at,
      (extract(epoch from p.created_at) * 1000)::bigint as created_ms
    from public.plans p
    join public.circles c on c.id = p.circle_id
    where p.mode = 'named'
      and p.state in ('collecting', 'ready')
      and p.organiser_user_id is not null
      and p.created_at <= now() - interval '48 hours'
      and c.status = 'active'
      and p.id = (
        select f.id from public.plans f
        where f.circle_id = p.circle_id and f.mode = 'named'
        order by f.created_at, f.id
        limit 1
      )
      and not exists (
        select 1 from public.plan_responses r
        where r.plan_id = p.id and r.user_id is distinct from p.organiser_user_id
      )
      and not exists (
        select 1 from private.first_plan_quiet_letters l where l.circle_id = p.circle_id
      )
    order by p.created_at, p.id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x;
$$;

comment on function public.dispatch_first_plan_quiet_candidates(integer) is
  'The circles'' first named plans that are still asking, 48 hours old or more, nobody but their organiser has answered, in an active circle never sent the founder''s first_plan_quiet letter: plan id and when it was made (ms). A superset; the domain decides. Service role only (SUS-240, ADR 0085).';

revoke all on function public.dispatch_first_plan_quiet_candidates(integer) from public;
revoke all on function public.dispatch_first_plan_quiet_candidates(integer) from anon, authenticated;
grant execute on function public.dispatch_first_plan_quiet_candidates(integer) to service_role;

-- supabase/sql/functions/public/stop_letters.sql
-- ---------------------------------------------------------------------------
-- Stopping a family of account-holder letters, without signing in.
--
-- One tap on the link under such a letter (ADR 0067, ADR 0069). The family says
-- what is stopped, and it writes the flag the settings screen writes for it:
--
--   * `nudges`    — the cadence nudge. `circle_members.muted_nudges` ("Nudges to
--                   plan the next one", ADR 0029), in every circle the person
--                   is an active member of: someone who asks for the reminders
--                   to stop has not asked for them to stop in one circle only.
--   * `organiser` — the letters about a plan the person organises
--                   (`options_ready`, `replies_closed`, `did_it_happen`, and
--                   the founder's one-off `first_plan_quiet`, ADR 0085).
--                   `profiles.muted_organiser_email` ("Emails about plans you
--                   organise"), the person's own row.
--   * `quiet`     — the quiet ask's two letters to its initiator
--                   (`threshold_initiator`, `quiet_expired`).
--                   `circle_members.muted_quiet_asks` ("Quiet asks"), in every
--                   circle the person is an active member of, for the same
--                   reason as the nudge.
--
-- **Scoped three ways.** The token's purpose must be the one the family names
-- (a token for one family is refused by the other two, a plan-update
-- preferences token by all three, and a verification or re-entry token too);
-- the person is the contact's owner and nobody else; and the only thing written
-- is that family's flag. Not the address, not plan email, not another family.
--
-- **Safe to repeat.** The token is not consumed and each update changes only
-- rows that are still unmuted, so a second tap, or a mail gateway that opens
-- the page and taps nothing, does no harm and changes nothing.
--
-- **Reveals nothing.** The answer is `{ "stopped": true }` and carries no name,
-- no circle, no address. A token that is unknown, tampered, expired, of another
-- family or of another purpose answers `link_expired`, the same for all of
-- them, so the endpoint does not say which tokens exist.
--
-- A letter of that family already queued (behind quiet hours) is skipped, so
-- the letter in the queue does not arrive after the person said stop. Service
-- role only.
-- ---------------------------------------------------------------------------

create or replace function public.stop_letters(p_token_hash bytea, p_family text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wanted text;
  owner private.email_contacts;
begin
  wanted := case p_family
    when 'nudges' then 'nudge_stop'
    when 'organiser' then 'organiser_stop'
    when 'quiet' then 'quiet_stop'
  end;

  select c.* into owner
  from private.email_action_tokens t
  join private.email_contacts c on c.id = t.contact_id
  where wanted is not null
    and t.token_hash = p_token_hash
    and t.purpose = wanted
    and t.expires_at > now()
    and c.user_id is not null;

  if not found then
    raise exception 'link_expired' using errcode = 'P0001';
  end if;

  if p_family = 'nudges' then
    update public.circle_members m
    set muted_nudges = true
    where m.user_id = owner.user_id
      and m.status = 'active'
      and not m.muted_nudges;

    update jobs.notification_jobs j
    set status = 'skipped', last_error = 'nudge_stopped', updated_at = now()
    where j.kind = 'about_time'
      and j.channel = 'email'
      and j.status = 'scheduled'
      and j.contact_id in (
        select c.id from private.email_contacts c where c.user_id = owner.user_id
      );
  elsif p_family = 'organiser' then
    update public.profiles p
    set muted_organiser_email = true
    where p.user_id = owner.user_id
      and not p.muted_organiser_email;

    update jobs.notification_jobs j
    set status = 'skipped', last_error = 'organiser_email_off', updated_at = now()
    where j.kind in ('options_ready', 'replies_closed', 'did_it_happen', 'first_plan_quiet')
      and j.channel = 'email'
      and j.status = 'scheduled'
      and j.contact_id in (
        select c.id from private.email_contacts c where c.user_id = owner.user_id
      );
  else
    update public.circle_members m
    set muted_quiet_asks = true
    where m.user_id = owner.user_id
      and m.status = 'active'
      and not m.muted_quiet_asks;

    update jobs.notification_jobs j
    set status = 'skipped', last_error = 'quiet_asks_muted', updated_at = now()
    where j.kind in ('threshold_initiator', 'quiet_expired')
      and j.channel = 'email'
      and j.status = 'scheduled'
      and j.contact_id in (
        select c.id from private.email_contacts c where c.user_id = owner.user_id
      );
  end if;

  return jsonb_build_object('stopped', true);
end;
$$;

comment on function public.stop_letters(bytea, text) is
  'Turns off one family of account-holder letters (nudges, organiser or quiet) for the owner of a stop token of that family, by writing the flag the settings screen writes, and skips their queued letters of that family. The token is not consumed; the answer reveals nothing. link_expired for an unknown, expired, other-family or other-purpose token. Service role only (ADR 0067, ADR 0069).';

revoke all on function public.stop_letters(bytea, text) from public;
revoke all on function public.stop_letters(bytea, text) from anon, authenticated;
grant execute on function public.stop_letters(bytea, text) to service_role;

-- END GENERATED: function definitions

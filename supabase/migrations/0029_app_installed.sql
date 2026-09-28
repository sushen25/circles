-- ---------------------------------------------------------------------------
-- 0029 — The app tier: `app_installed_at`, stamped once (SUS-92, S3-01a).
--
-- `profiles.app_installed_at` has existed since 0002, with an update grant to
-- `authenticated` and nothing that wrote it. It becomes the record of the
-- first time somebody opened the installed app signed in, which is what makes
-- their tier `app` (§10) and what every app prompt's pre-check reads.
--
-- **One writer.** `public.mark_app_installed()` stamps it only while it is
-- null and announces `growth.app_first_open_linked` from that call only, and
-- the column's update grant is taken away from `authenticated`, so a client
-- cannot set it, clear it and set it again to be counted twice. Reading it is
-- unchanged: `profiles_select_own` still shows a person their own row.
--
-- **The outbox learns one event name**, from `DOMAIN_EVENT_NAMES` in
-- `packages/domain/src/shared/events.ts`; `gen-events.mjs` renders the list
-- into this migration's constraint and now points here. The function itself is
-- rendered from `supabase/sql/functions/public/mark_app_installed.sql` by
-- `gen-sql-functions.mjs`, which also points here (ADR 0015).
-- ---------------------------------------------------------------------------
begin;

alter table jobs.outbox drop constraint outbox_event_name;
alter table jobs.outbox add constraint outbox_event_name check (event_name in (
-- BEGIN GENERATED: event names (scripts/gen-events.mjs)
    'circles.circle_created',
    'circles.member_joined',
    'circles.member_removed',
    'circles.invite_rotated',
    'circles.member_reattached',
    'planning.plan_created',
    'planning.plan_revised',
    'planning.plan_expired',
    'planning.plan_cancelled',
    'planning.quiet_ask_created',
    'planning.interest_recorded',
    'planning.threshold_reached',
    'planning.organiser_accepted',
    'planning.organiser_changed',
    'planning.deadline_passed',
    'availability.response_submitted',
    'availability.response_cleared',
    'scheduling.candidates_generated',
    'scheduling.no_eligible_candidates',
    'confirmation.meetup_confirmed',
    'confirmation.meetup_rescheduled',
    'confirmation.meetup_cancelled',
    'confirmation.attendance_updated',
    'confirmation.outcome_reported',
    'communication.contact_verified',
    'communication.subscription_changed',
    'communication.delivery_recorded',
    'growth.nudge_shown',
    'growth.nudge_answered',
    'growth.account_claimed',
    'growth.app_first_open_linked'
-- END GENERATED: event names
));

revoke update (app_installed_at) on public.profiles from authenticated;

comment on column public.profiles.app_installed_at is
  'The first time this person opened the installed app signed in (S3-01a); their tier is `app` from then. Written only by public.mark_app_installed(), once.';

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/mark_app_installed.sql
-- ---------------------------------------------------------------------------
-- The app has been opened, signed in, on some device (S3-01a): the identity
-- tier becomes `app` (guest-to-app flow, §10).
--
-- **Once per profile, whatever the client retries.** The column is stamped
-- only while it is null, and the event is announced only by the call that
-- stamped it, so a second device, a reinstall or a retried request is a no-op
-- that answers with the first time. `mark-app-installed` is the one caller.
--
-- **The caller's own row, and only a saved place.** An anonymous identity has
-- no app tier — the app signs somebody in before it records anything — so a
-- guest's call changes nothing and says so (`installed_at` null). The user is
-- `auth.uid()`, never a parameter.
--
-- Definer, because the event goes through `jobs.emit`, which a member cannot
-- call; and because 0029 takes the column's update grant away from
-- `authenticated`, so that this is the only writer and "exactly once" is the
-- database's promise rather than the client's manners.
-- ---------------------------------------------------------------------------

create or replace function public.mark_app_installed()
returns table (installed_at timestamptz, first_open boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  stamped timestamptz;
begin
  if me is null or not public.auth_is_permanent() then
    return query select null::timestamptz, false;
    return;
  end if;

  update public.profiles p
  set app_installed_at = now()
  where p.user_id = me and p.app_installed_at is null
  returning p.app_installed_at into stamped;

  if stamped is not null then
    perform jobs.emit('growth.app_first_open_linked', 'account', me,
      jsonb_build_object('user_id', me));
    return query select stamped, true;
    return;
  end if;

  return query
    select p.app_installed_at, false
    from public.profiles p
    where p.user_id = me;
end;
$$;

comment on function public.mark_app_installed() is
  'Stamps the caller''s profiles.app_installed_at the first time the app is opened signed in, and emits growth.app_first_open_linked from that call only (S3-01a). A retry, a second device or a guest changes nothing. The only writer of the column.';

revoke all on function public.mark_app_installed() from public;
revoke all on function public.mark_app_installed() from anon, authenticated;
grant execute on function public.mark_app_installed() to authenticated;

-- END GENERATED: function definitions

commit;

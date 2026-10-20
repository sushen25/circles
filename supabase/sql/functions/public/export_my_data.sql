-- ---------------------------------------------------------------------------
-- "Export my data" (spec §13; architecture §9.1; S4-05, ADR 0083).
--
-- The caller's own data as one JSON document, and nobody else's. It is written
-- as a list of what is *theirs* — rows keyed on their own user id — rather than
-- as "everything in a circle minus what they should not see", because the
-- second shape leaks the day a column is added and the first leaks nothing it
-- was not told about.
--
--   * No other member appears: no id, no name, no address. Circle names are
--     given only for circles they are still in, and a plan's title only for a
--     plan they organise; a plan they answered is a plan id and a category.
--   * Their address is the hint (`m…@example.com`), the same as Account shows.
--     Push tokens are not exported: a device token is a credential, not a fact
--     about the person.
--   * `available_user_ids` on a confirmation, `plan_initiators` and the
--     quiet-ask tallies are other people's or the circle's, not theirs.
--
-- One export a day: the limit is here, not only in the Edge Function, because
-- the function is callable directly and a limit that lives only in the caller
-- is not one.
-- ---------------------------------------------------------------------------

create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  hint text;
  doc jsonb;
begin
  if me is null then
    raise exception 'export_my_data requires a signed-in actor'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.take_rate_token(
    'export_my_data', extensions.digest(me::text, 'sha256'), 1, interval '1 day'
  ) then
    raise exception 'too_many_requests' using errcode = 'too_many_rows';
  end if;

  select public.own_email_hint() into hint;

  select jsonb_build_object(
    'exported_at', now(),
    'account', (
      select jsonb_build_object(
        'display_name', p.display_name,
        'time_zone', p.time_zone,
        'saved_place', p.is_permanent,
        'created_at', p.created_at,
        'email_hint', hint,
        'organiser_email_muted', p.muted_organiser_email
      ) from public.profiles p where p.user_id = me
    ),
    'circles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'circle_id', m.circle_id,
        'circle_name', case when m.status = 'active' then c.name end,
        'my_name_there', m.display_name_snapshot,
        'role', m.role,
        'status', m.status,
        'joined_at', m.joined_at,
        'muted_quiet_asks', m.muted_quiet_asks,
        'muted_nudges', m.muted_nudges,
        'muted_all', m.muted_all
      ) order by m.joined_at, m.circle_id)
      from public.circle_members m
      join public.circles c on c.id = m.circle_id
      where m.user_id = me
    ), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', r.plan_id,
        'revision', r.revision,
        'answer', r.status,
        'submitted_at', r.submitted_at,
        'used_calendar_overlay', r.used_calendar_overlay,
        'windows', coalesce((
          select jsonb_agg(jsonb_build_object('starts_at', w.starts_at, 'ends_at', w.ends_at)
                           order by w.starts_at)
          from public.willing_windows w where w.response_id = r.id
        ), '[]'::jsonb)
      ) order by r.submitted_at, r.id)
      from public.plan_responses r where r.user_id = me
    ), '[]'::jsonb),
    'usual_times', coalesce((
      select jsonb_agg(jsonb_build_object(
        'circle_id', d.circle_id, 'summary', d.summary, 'computed_at', d.computed_at
      ) order by d.circle_id)
      from public.member_dayparts d where d.user_id = me
    ), '[]'::jsonb),
    'quiet_ask_answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', i.plan_id, 'answer', i.response, 'answered_at', i.responded_at
      ) order by i.responded_at, i.plan_id)
      from private.plan_interest i where i.user_id = me
    ), '[]'::jsonb),
    'plans_i_organise', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', p.id, 'title', p.title, 'state', p.state,
        'window_start', p.window_start, 'window_end', p.window_end
      ) order by p.created_at, p.id)
      from public.plans p where p.organiser_user_id = me
    ), '[]'::jsonb),
    'meetups_i_confirmed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'confirmation_id', k.id, 'plan_id', k.plan_id,
        'starts_at', k.starts_at, 'ends_at', k.ends_at,
        'place_name', k.place_name, 'note', k.note, 'confirmed_at', k.confirmed_at
      ) order by k.confirmed_at, k.id)
      from public.meetup_confirmations k where k.confirmed_by = me
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'confirmation_id', a.confirmation_id, 'status', a.status, 'updated_at', a.updated_at
      ) order by a.updated_at, a.confirmation_id)
      from public.attendance a where a.user_id = me
    ), '[]'::jsonb),
    'outcome_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'confirmation_id', o.confirmation_id, 'outcome', o.outcome, 'note', o.note,
        'moved_outside', o.moved_outside, 'reported_at', o.reported_at
      ) order by o.reported_at, o.id)
      from public.outcome_reports o where o.reported_by = me
    ), '[]'::jsonb),
    'nudges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'moment', n.moment, 'plan_id', n.plan_id, 'shown_at', n.shown_at,
        'answer', n.answer, 'snoozed_until', n.snoozed_until, 'answered_at', n.answered_at
      ) order by n.shown_at, n.id)
      from public.nudge_states n where n.user_id = me
    ), '[]'::jsonb),
    'email', jsonb_build_object(
      'contacts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'status', c.status,
          'verified_at', c.verified_at, 'suppressed_at', c.suppressed_at
        ) order by c.created_at, c.id)
        from private.email_contacts c where c.user_id = me
      ), '[]'::jsonb),
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'scope', s.scope, 'plan_id', s.plan_id, 'status', s.status,
          'consented_at', s.consented_at, 'withdrawn_at', s.withdrawn_at,
          'consent_text_version', s.consent_text_version
        ) order by s.consented_at, s.id)
        from private.email_subscriptions s where s.user_id = me
      ), '[]'::jsonb)
    ),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'platform', d.platform, 'enabled', d.enabled, 'added_at', d.created_at
      ) order by d.created_at, d.id)
      from private.push_devices d where d.user_id = me
    ), '[]'::jsonb)
  ) into doc;

  return doc;
end;
$$;

comment on function public.export_my_data() is
  'The caller''s own data as one JSON document, and nobody else''s; one a day (S4-05, ADR 0083).';

revoke all on function public.export_my_data() from public;
revoke all on function public.export_my_data() from anon, authenticated;
grant execute on function public.export_my_data() to authenticated;

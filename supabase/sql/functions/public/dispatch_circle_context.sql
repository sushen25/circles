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
--   * `prompted_for` — the due date already decided for this cycle (the
--     circle's current `last_met_at`), from `private.cadence_prompts`, or
--     null. Set, and this cycle's nudge has been decided: one per cycle. An
--     older row is an earlier cycle's, however late its due date — a circle
--     nudged a week early that met before the date it was asked for has
--     started a new cycle (review round 2).
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
      select cp.due_date from private.cadence_prompts cp
      where cp.circle_id = c.id and cp.last_met_at = c.last_met_at
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
  'One circle''s state for the cadence nudge: the circle, every membership row (with its nudge switch), whether a plan is open, the last happened meetup''s organiser and attendees, and the due date already prompted this cycle. Ids and display names; never an address or a token. Service role only (S2-04).';

revoke all on function public.dispatch_circle_context(uuid) from public;
revoke all on function public.dispatch_circle_context(uuid) from anon, authenticated;
grant execute on function public.dispatch_circle_context(uuid) to service_role;

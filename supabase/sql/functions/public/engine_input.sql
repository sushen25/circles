-- ---------------------------------------------------------------------------
-- Everything the candidate engine needs about a plan, in one read.
--
-- Three tables and a join, and the reason it is a function rather than three
-- queries from the Edge Function is that the engine's answer is only as
-- trustworthy as the inputs agreeing with each other. Read separately, the
-- roster can change between the members query and the responses query, and the
-- set that comes out is one nobody ever had: a member who answered and is no
-- longer there, or one who joined between the two statements and appears as a
-- non-responder to a question they were never asked. One statement is one
-- snapshot.
--
-- It is `stable`, and deliberately takes no lock: the compare-and-set in
-- `store_candidate_set` is what makes a stale result harmless, so reading
-- without blocking answers is right. A recalculation that loses the race is
-- discarded and another follows.
--
-- In `public` because PostgREST exposes nothing else, and granted to
-- `service_role` alone: this returns every member's answer to a plan, which is
-- precisely what `plan_responses_select_own` exists to stop a client seeing
-- (spec §5.5 — "your friends will only see a combined result"). The combined
-- result is what `candidates` holds, and that is the table clients read.
-- ---------------------------------------------------------------------------

create or replace function public.engine_input(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'plan', jsonb_build_object(
      'id', p.id,
      'circle_id', p.circle_id,
      'state', p.state,
      'revision', p.revision,
      'input_version', p.input_version,
      'scoring_version', p.scoring_version,
      'time_zone', p.time_zone,
      'window_start', p.window_start,
      'window_end', p.window_end,
      'daily_start_local', p.daily_start_local,
      'daily_end_local', p.daily_end_local,
      'duration_minutes', p.duration_minutes,
      'quorum', p.quorum,
      'response_deadline', p.response_deadline,
      'required_member_ids', (
        select coalesce(jsonb_agg(rm.user_id order by rm.user_id), '[]'::jsonb)
        from public.plan_required_members rm
        where rm.plan_id = p.id and rm.revision = p.revision
      )
    ),
    -- Order is part of the input, not a detail of the read: every available
    -- list the engine returns is sorted into this order, and `inputHash`
    -- includes it unsorted for exactly that reason. Joining date first, id to
    -- break ties — stable, and the order a roster is read in.
    'active_member_ids', (
      select coalesce(jsonb_agg(m.user_id order by m.joined_at, m.user_id), '[]'::jsonb)
      from public.circle_members m
      where m.circle_id = p.circle_id and m.status = 'active'
    ),
    -- Answers to the revision being asked, from members who are still here. The
    -- engine filters by active membership too — it walks `active_member_ids` —
    -- and this filter is what keeps `responded_count` honest as well: a plan
    -- whose one reply came from somebody who has left is still waiting for its
    -- first.
    'responses', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'user_id', r.user_id,
            'status', r.status,
            'windows', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object('start', w.starts_at, 'end', w.ends_at)
                  order by w.starts_at
                ),
                '[]'::jsonb
              )
              from public.willing_windows w
              where w.response_id = r.id
            )
          )
          order by r.user_id
        ),
        '[]'::jsonb
      )
      from public.plan_responses r
      join public.circle_members m
        on m.circle_id = p.circle_id and m.user_id = r.user_id and m.status = 'active'
      where r.plan_id = p.id and r.revision = p.revision
    )
  )
  from public.plans p
  where p.id = p_plan_id;
$$;

comment on function public.engine_input(uuid) is
  'One consistent snapshot of a plan, its active roster and the answers to its current revision, shaped for generateCandidates. Service role only: it carries every member''s answer.';

revoke all on function public.engine_input(uuid) from public;
revoke all on function public.engine_input(uuid) from anon, authenticated;
grant execute on function public.engine_input(uuid) to service_role;

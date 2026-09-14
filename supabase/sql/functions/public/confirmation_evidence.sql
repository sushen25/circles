-- ---------------------------------------------------------------------------
-- What became of a meetup, in numbers rather than names.
--
-- `attendance_select_member` shows a **retrospective** answer only to the person
-- who gave it: "nobody is scored and nobody is told who came" (spec §5.10) is a
-- policy, not a copy decision. Which means the organiser — the one person who
-- needs to know whether their report was corroborated — cannot see the
-- `was_there` rows that would corroborate it, and neither can the endpoint
-- reading through their session.
--
-- So the counting happens here, where a definer function can see the rows, and
-- what comes back has no identity in it at all: how many said they were there,
-- how many said they missed it, and the one comparison the corroboration rule
-- needs — whether anybody *other than the reporter* said they were there
-- (§11.1: "corroborated happened" = at least one other member confirms).
--
-- The rule itself is not here. `corroborationOf` in `packages/domain` turns
-- these facts into the word, because the metric and the screen have to agree
-- about what corroboration means and a second copy of that is how they stop.
-- ---------------------------------------------------------------------------

create or replace function public.confirmation_evidence(p_confirmation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  confirmation public.meetup_confirmations;
  circle uuid;
  reporter uuid;
  reported text;
begin
  select * into confirmation
  from public.meetup_confirmations c where c.id = p_confirmation_id;
  if not found then
    raise exception 'confirmation_not_found' using errcode = 'P0001';
  end if;

  select p.circle_id into circle from public.plans p where p.id = confirmation.plan_id;

  -- Definer, so RLS is not answering: the membership question has to be asked
  -- out loud. Only active members of the circle see any of this (§8.2), and a
  -- non-member gets the same answer as a confirmation that is not there.
  if not public.auth_is_member(circle) then
    raise exception 'confirmation_not_found' using errcode = 'P0001';
  end if;

  select r.reported_by, r.outcome into reporter, reported
  from public.outcome_reports r
  where r.confirmation_id = p_confirmation_id
  order by r.reported_at
  limit 1;

  return jsonb_build_object(
    'outcome', reported,
    'was_there', (
      select count(*) from public.attendance a
      where a.confirmation_id = p_confirmation_id and a.status = 'was_there'
    ),
    'missed', (
      select count(*) from public.attendance a
      where a.confirmation_id = p_confirmation_id and a.status = 'missed'
    ),
    -- The one comparison, made here because it needs the ids and returns none
    -- of them. False when nobody has reported: there is no reporter to be
    -- "other than" yet.
    'someone_else_was_there', coalesce((
      select exists (
        select 1 from public.attendance a
        where a.confirmation_id = p_confirmation_id
          and a.status = 'was_there'
          and a.user_id is distinct from reporter
      ) and reporter is not null
    ), false)
  );
end;
$$;

comment on function public.confirmation_evidence(uuid) is
  'How many said they were there or missed it, and whether anybody other than the reporter did — counts only, never identities. For members of the circle.';

revoke all on function public.confirmation_evidence(uuid) from public;
revoke all on function public.confirmation_evidence(uuid) from anon;
grant execute on function public.confirmation_evidence(uuid) to authenticated;

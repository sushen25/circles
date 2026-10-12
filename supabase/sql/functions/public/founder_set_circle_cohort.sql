-- ---------------------------------------------------------------------------
-- The founder sets a circle's cohort (SUS-178, ADR 0058).
--
-- Spec §11.4 splits the decision gates into the founder cohort's and the
-- external cohort's. A circle starts in the cohort its owner's allowlist
-- membership says (`private.assign_circle_cohort`); this is how the founder
-- corrects it, for a test circle owned by a friend or one made before the
-- founder was on the allowlist.
--
-- **The same allowlist as `founder_analytics`, checked against `auth.uid()`,
-- never a parameter.** Everybody else, `anon` included, is refused with
-- `insufficient_privilege` before the circle is even looked at. Nothing in the
-- product calls this and nothing returns the cohort to a client: the answer is
-- void, so setting a cohort does not read one.
-- ---------------------------------------------------------------------------
create or replace function public.founder_set_circle_cohort(p_circle_id uuid, p_cohort text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not exists (
    select 1 from private.allowlist a where a.user_id = caller
  ) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;

  if p_cohort is null or p_cohort not in ('founder', 'external') then
    raise exception 'invalid_cohort' using errcode = '22023';
  end if;

  update private.circle_cohorts
  set cohort = p_cohort, source = 'founder', set_at = now()
  where circle_id = p_circle_id;

  if not found then
    raise exception 'circle_not_found' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.founder_set_circle_cohort(uuid, text) is
  'Sets a circle''s cohort (founder or external) for a user in private.allowlist and nobody else. The allowlist is checked against auth.uid(). Returns nothing: a cohort is never read back to a client.';

revoke all on function public.founder_set_circle_cohort(uuid, text) from public;
revoke all on function public.founder_set_circle_cohort(uuid, text) from anon;
grant execute on function public.founder_set_circle_cohort(uuid, text) to authenticated;

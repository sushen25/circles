-- Statement-level, over transition tables, and suppressed inside
-- `replace_response`, which bumps exactly once itself. The first version was
-- row-level: replacing two windows with two others bumped five times, and the
-- version came to depend on how many windows a person painted — the per-row
-- behaviour ADR 0013 exists to rule out. The trigger is still here for every
-- other write path (a retention job, a migration), bumping once per statement.

create or replace function public.bump_input_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('circles.in_replace_response', true), '') = 'on' then
    return null;
  end if;

  if tg_table_name = 'plan_responses' then
    update public.plans p
    set input_version = p.input_version + 1
    where (p.id, p.revision) in (
      select r.plan_id, r.revision from changed r
    );
  else
    update public.plans p
    set input_version = p.input_version + 1
    where (p.id, p.revision) in (
      select r.plan_id, r.revision
      from changed w
      join public.plan_responses r on r.id = w.response_id
    );
  end if;
  return null;
end;
$$;

revoke all on function public.bump_input_version() from public;
revoke all on function public.bump_input_version() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- When a prompt was answered (S2-07).
--
-- The 30-day back-off runs from the second "not now" (`appBackOffUntil` in
-- `packages/domain/src/growth`), so the time an answer was given is a fact the
-- rules read. `updated_at` is not it: `move_membership` rewrites `user_id` on a
-- reattach, which would restart a back-off every time somebody came back on a
-- new browser. So the answer stamps its own column, here rather than in the
-- client, because the client writes this table directly (§8.4) and a stamp it
-- could leave out is not one the rule can lean on.
-- ---------------------------------------------------------------------------

create or replace function public.stamp_nudge_answer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.answered_at := case when new.answer is null then null else now() end;
  elsif new.answer is distinct from old.answer then
    new.answered_at := case when new.answer is null then null else now() end;
  else
    new.answered_at := old.answered_at;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_nudge_answer() from public;
revoke all on function public.stamp_nudge_answer() from anon, authenticated;

-- What deleting the account would do to the circles its owner is about to
-- leave, so the screen can say it before asking (S4-05, ADR 0083). One row per
-- circle the caller owns: who it would go to, or null when it would be
-- archived. The same choice `delete_account` makes, read, not written; a
-- member of the circle sees the heir's name on the roster anyway.

create or replace function public.account_deletion_preview()
returns table (circle_id uuid, circle_name text, heir_display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name,
    (
      select m.display_name_snapshot
      from public.circle_members m
      join public.profiles p on p.user_id = m.user_id
      where m.circle_id = c.id and m.status = 'active'
        and m.user_id <> c.owner_user_id and p.is_permanent
      order by m.joined_at, m.user_id
      limit 1
    )
  from public.circles c
  where c.owner_user_id = (select auth.uid()) and c.status = 'active'
  order by c.created_at, c.id;
$$;

comment on function public.account_deletion_preview() is
  'The circles the caller owns and, for each, who would inherit it on account deletion or null when it would be archived (S4-05).';

revoke all on function public.account_deletion_preview() from public;
revoke all on function public.account_deletion_preview() from anon, authenticated;
grant execute on function public.account_deletion_preview() to authenticated;

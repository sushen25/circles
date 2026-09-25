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

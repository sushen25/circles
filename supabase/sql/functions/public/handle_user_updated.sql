-- Saving your place *updates* the auth row; it does not insert one.
--
-- `linkIdentity` attaches Apple, Google or an email identity to the anonymous
-- user already signed in, so an insert-only trigger would leave the profile
-- saying `is_permanent = false` forever. The JWT would be right and the durable
-- record wrong, which is the direction that bites later: reattachment must
-- never target a saved-place member, and it reads the record.
--
-- One direction only. There is no path back from a saved place to an anonymous
-- session, and a trigger that could take one would be a way to shed an
-- organiser role by unlinking.

create or replace function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_anonymous then
    update public.profiles p
    set is_permanent = true
    where p.user_id = new.id and not p.is_permanent;
  end if;
  return new;
end;
$$;

comment on function public.handle_user_updated() is
  'Marks a profile permanent when the auth row stops being anonymous (linkIdentity). One direction only: a saved place cannot be given back.';

revoke all on function public.handle_user_updated() from public;
revoke all on function public.handle_user_updated() from anon, authenticated;

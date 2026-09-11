-- ---------------------------------------------------------------------------
-- The signup trigger.
--
-- `is_permanent` is derived from the auth row rather than trusted from a
-- client: an anonymous session that could set its own flag would walk straight
-- through the organiser gate.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, time_zone, is_permanent)
  values (
    new.id,
    -- A name the person gave, if they gave one. Never an email address or any
    -- part of one: display names are shown to the whole circle (§14).
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Guest'),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'time_zone'), ''), 'UTC'),
    -- The column, not the `raw_app_meta_data` copy: it is what GoTrue sets and
    -- what the JWT claim is derived from, so this cannot disagree with the gate.
    not coalesce(new.is_anonymous, false)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the profile for a new auth user, with is_permanent derived from the auth row rather than supplied by the client.';

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon, authenticated;

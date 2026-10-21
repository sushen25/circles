-- ---------------------------------------------------------------------------
-- tag_circle_source
--
-- The campaign tag a circle's organiser arrived on (`?from=<tag>`, SUS-240),
-- written to that circle's founder-only cohort row as `source_ref`.
--
-- **A label for the post, never for the person.** The tag goes on
-- `private.circle_cohorts`, which no client role can read (ADR 0058): not on
-- `circles`, not on a profile, not beside a name or an address, and in no
-- event, log line or email. This function returns nothing, so tagging a circle
-- does not read one either.
--
-- **Only the owner of the circle may tag it, and only once.** The owner is
-- found by `auth.uid()` through `auth_is_owner`, as the other owner-only
-- writes find them; a caller who is not the owner, an unknown circle and an
-- anonymous session all get the same `circle_not_found`. A circle that already
-- has a tag keeps it: the first one is the post the organiser came from, and a
-- later call (a retry, a second tab) says nothing different.
--
-- **A tag that is not a slug is dropped, not refused** (`^[a-z0-9-]{1,40}$`,
-- `parseSourceRef` in `packages/domain`): a label must never be the reason a
-- circle is not made, and the column's check constraint is the last word.
-- ---------------------------------------------------------------------------
create or replace function public.tag_circle_source(p_circle_id uuid, p_source_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.auth_is_owner(p_circle_id) then
    raise exception 'circle_not_found' using errcode = 'P0002';
  end if;

  if p_source_ref is null or p_source_ref !~ '^[a-z0-9-]{1,40}$' then
    return;
  end if;

  update private.circle_cohorts cc
  set source_ref = p_source_ref
  where cc.circle_id = p_circle_id and cc.source_ref is null;
end;
$$;

comment on function public.tag_circle_source(uuid, text) is
  'Records the campaign tag a circle''s organiser arrived on, on the founder-only cohort row, once. Owner only. A tag that is not a slug is ignored. Returns nothing: a tag is never read back to a client.';

revoke all on function public.tag_circle_source(uuid, text) from public;
revoke all on function public.tag_circle_source(uuid, text) from anon;
grant execute on function public.tag_circle_source(uuid, text) to authenticated;

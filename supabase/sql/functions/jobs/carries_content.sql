-- ---------------------------------------------------------------------------
-- Non-negotiable 8, as a function.
--
-- Three tables here hold free-form JSON that is read by the dispatcher, the
-- notification pipeline and analytics, and none of them may be handed a
-- name, an email, a note, a title or a token. This walks the whole document —
-- objects inside arrays inside objects — because a check that looks only at
-- the top level is a promise about the shape the writer happened to use, and
-- `{"context": {"email": …}}` is a payload somebody will write in good faith.
--
-- Keys are matched by *fragment*, not by name: `recipient_email` and
-- `event_title` are the same leak with a prefix. The fragments are
-- `FORBIDDEN_PAYLOAD_KEYS` in packages/contracts/analytics.ts — the same list
-- the analytics catalogue test applies — rendered here by
-- scripts/gen-events.mjs, so the two cannot drift.
--
-- And values are checked, not only keys, because `{"value": "a@b.com"}` has
-- an innocent key. A string in one of these documents is an id, an instant,
-- an enum or a zone name — never words. So every string leaf must be at most
-- 40 characters of `[A-Za-z0-9_./:+-]`: no `@` (an address), no space (a
-- sentence), nothing a 256-bit token fits in. It cannot tell a one-word note
-- from an enum; it can refuse everything the invariant actually names.
-- ---------------------------------------------------------------------------

create or replace function jobs.carries_content(p_document jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with recursive nodes (node) as (
    select p_document
    union all
    select child
    from nodes,
    lateral (
      select value from jsonb_each(case when jsonb_typeof(node) = 'object' then node else '{}'::jsonb end)
      union all
      select value from jsonb_array_elements(case when jsonb_typeof(node) = 'array' then node else '[]'::jsonb end)
    ) as children (child)
  )
  select exists (
    select 1
    from nodes,
      jsonb_object_keys(case when jsonb_typeof(node) = 'object' then node else '{}'::jsonb end) as k,
      unnest(
-- BEGIN GENERATED: forbidden key fragments (scripts/gen-events.mjs)
    array['name', 'email', 'note', 'token', 'title', 'secret', 'address', 'phone', 'message']
-- END GENERATED: forbidden key fragments
      ) as fragment
    where lower(k) like '%' || fragment || '%'
  )
  or exists (
    select 1 from nodes
    where jsonb_typeof(node) = 'string'
      and not ((node #>> '{}') ~ '^[A-Za-z0-9_./:+-]{1,40}$')
  );
$$;

comment on function jobs.carries_content(jsonb) is
  'True when any object at any depth carries a key naming a person, an address, a note, a title or a token, or any string value that is not an id, an instant, an enum or a zone. The check constraint on outbox, audit_log and analytics.events.';

revoke all on function jobs.carries_content(jsonb) from public;
revoke all on function jobs.carries_content(jsonb) from anon, authenticated;
grant execute on function jobs.carries_content(jsonb) to service_role;

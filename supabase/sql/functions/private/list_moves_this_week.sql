-- ---------------------------------------------------------------------------
-- How many times a membership has been moved by picking a name this week
-- (ADR 0006, ADR 0048): the number `reattach_member`'s cap is about.
--
-- Counting is not a simple `where user_id = target`: every reattachment
-- *changes* the membership's user id, so the previous ones are recorded against
-- identities this one has never seen. The audit rows form a chain — each names the
-- identity it moved from and the one it moved to — and the membership's history is
-- the walk backwards along it.
--
-- Only the moves somebody made **by picking a name** are counted. The cap exists
-- to stop a name being passed back and forth by people who prove nothing, and it
-- used to count the member's own moves too, so somebody who took a place, let its
-- owner take it back, and took it again left the owner — with a valid emailed link
-- in hand — refused for a week. A move made with an emailed re-entry link is
-- recorded (`source: 'email'`) and the walk crosses it, because it is a link in the
-- chain, but it is not charged. Rows written without a `source` count: the
-- stricter reading, for a window that closes in seven days.
--
-- `union`, not `union all`, and the row's own id in the result — because the chain
-- can be a *cycle*. A membership moves A→B, and later, from the session on device A
-- that is still valid, B→A. The history then loops A→B→A→B, and `union all`
-- follows it until the statement is cancelled or the server runs out of memory.
-- `union` discards a row already in the result, so revisiting the same audit row
-- ends the recursion; carrying the id keeps two genuinely separate moves between
-- the same pair of identities counted as two.
-- ---------------------------------------------------------------------------

create or replace function private.list_moves_this_week(p_circle_id uuid, p_member uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain (id, from_id, to_id, via) as (
    select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
           coalesce(a.metadata ->> 'source', 'list')
    from private.audit_log a
    where a.action = 'circles.member_reattached'
      and a.resource_id = p_circle_id
      and a.occurred_at > now() - interval '7 days'
      and a.metadata ->> 'to_user_id' = p_member::text
    union
    select a.id, a.metadata ->> 'from_user_id', a.metadata ->> 'to_user_id',
           coalesce(a.metadata ->> 'source', 'list')
    from private.audit_log a
    join chain on a.metadata ->> 'to_user_id' = chain.from_id
    where a.action = 'circles.member_reattached'
      and a.resource_id = p_circle_id
      and a.occurred_at > now() - interval '7 days'
  )
  select count(*) filter (where via = 'list')::integer from chain;
$$;

revoke all on function private.list_moves_this_week(uuid, uuid) from public;
revoke all on function private.list_moves_this_week(uuid, uuid) from anon, authenticated;

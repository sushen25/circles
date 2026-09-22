-- The quorum a plan carries while nobody has chosen one (ADR 0026).
--
-- `max(3, quorum_default(n))`, where `quorum_default` is `max(2, ceil(n × 0.6))`
-- — the same rule as `quorumDefault` in `packages/domain/src/circles/quorum.ts`,
-- and this copy is the authoritative one: it is a transition guard, so it lives
-- in both places by design (AGENTS.md, architecture §6.4), and `100_plan_lifecycle`
-- walks the same counts the domain's unit test does.
--
-- The floor is why this is not just `quorum_default`. First run makes a plan on
-- a circle of **one** and shares the plan's link rather than an invite, so the
-- count at creation is the organiser alone. `quorum_default(1)` and
-- `quorum_default(2)` are both 2, so without the floor the first friend to
-- answer would take the plan to `ready` and the organiser would be shown a best
-- time for two people while the rest of the chat was still reading the message.
-- Three is `member_cap`'s sibling: the count at which "most of us" stops
-- meaning "both of us".
--
-- 1→3, 3→3, 5→3, 6→4, 8→5, 12→8.
create or replace function public.soft_quorum(active_member_count integer)
returns integer
language sql
immutable
as $$
  select greatest(3, greatest(2, ceil(coalesce(active_member_count, 0) * 0.6)::integer));
$$;

comment on function public.soft_quorum(integer) is
  'The quorum a plan carries while its quorum_source is defaulted: max(3, the 60% default). Mirrors softQuorum in @circles/domain (ADR 0026).';

revoke all on function public.soft_quorum(integer) from public;
revoke all on function public.soft_quorum(integer) from anon, authenticated;

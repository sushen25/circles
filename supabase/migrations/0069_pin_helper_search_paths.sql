-- 0069_pin_helper_search_paths
--
-- SUS-192: four `language sql` helpers had no pinned `search_path`
-- (advisor `function_search_path_mutable`): `public.member_cap`,
-- `public.canonical_display_name`, `public.soft_quorum` and
-- `planning.allowed_keys`. They are invoker functions and touch nothing but
-- `pg_catalog`, so the risk was low; now they say `set search_path = ''` and
-- the warning goes. Numbered 0069 because open PR #231 holds 0068; renumber if
-- the merge order changes.

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/planning/allowed_keys.sql
-- The payload keys an action may carry. Anything else is refused, not ignored:
-- a caller that sends `quorum` with a `cancel` has misunderstood something,
-- and silently dropping it would let the misunderstanding ship.
--
-- `confirm` carries the confirmation's details as well as the candidate,
-- because `transition_plan` writes the confirmation row itself.

create or replace function planning.allowed_keys(action text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    -- `adjust` takes these two and *only* these two, which is what makes the
    -- split between "changes the question" and "changes what happens to the
    -- answers" structural rather than a comparison somebody has to remember
    -- (spec §5.3). A window cannot ride along on an adjustment.
    when action = 'adjust' then array['quorum', 'response_deadline']
    -- Days taken away that nobody picked (ADR 0047): the window's ends may
    -- move inward, and the two keys an adjustment takes may ride along. Never
    -- the band or the duration, which are always a new question.
    -- `revise_plan` derives it; no caller names it.
    when action = 'narrow' then array['window_start', 'window_end', 'quorum', 'response_deadline']
    -- The quorum alone. `quorum_follows` is the circle moving a quorum nobody
    -- chose (ADR 0026); a deadline riding along on it would be a change no
    -- organiser asked for and nobody announced.
    when action = 'quorum_follows' then array['quorum']
    when action in ('edit', 'reopen') then array[
      'window_start', 'window_end', 'daily_start_local', 'daily_end_local',
      'duration_minutes', 'quorum', 'response_deadline'
    ]
    when action = 'cancel' then array['cancel_note']
    -- A quiet ask opening is asked for times from that moment, so its deadline
    -- is set then: `defaultDeadline` for its window as of *now*, not as of when
    -- it was asked (`onThreshold`, spec §5.4.5). The only key it takes.
    when action = 'threshold_reached' then array['response_deadline']
    -- Who takes the plan over, and nothing else: a hand-off changes who
    -- decides, not what is being decided (S2-05).
    when action = 'hand_off' then array['organiser_user_id']
    when action = 'confirm' then array['candidate_id', 'place_name', 'place_url', 'note', 'chased_answer']
    -- The organiser's own time and edits to it (ADR 0051). The stretch is two
    -- instants; `edit_confirmed` and a move say the place and note whole, a
    -- present key with a null clearing it.
    when action = 'confirm_own' then array[
      'starts_at', 'ends_at', 'place_name', 'place_url', 'note', 'chased_answer'
    ]
    when action = 'move_confirmed' then array[
      'starts_at', 'ends_at', 'place_name', 'place_url', 'note'
    ]
    when action = 'edit_confirmed' then array['place_name', 'place_url', 'note']
    else array[]::text[]
  end;
$$;

revoke all on function planning.allowed_keys(text) from public;
revoke all on function planning.allowed_keys(text) from anon, authenticated;

-- supabase/sql/functions/public/canonical_display_name.sql
-- ---------------------------------------------------------------------------
-- What makes two names the same name.
--
-- This is `comparable()` from `packages/domain/src/circles/display-name.ts`,
-- rewritten in SQL because the index has to agree with it. Two implementations
-- of one rule is one rule that disagrees with itself, and here the disagreement
-- is silent: the domain refuses a name the database has already accepted, and
-- the roster shows two people called Zoe.
--
-- Collapse whitespace, trim, decompose, drop the diacritics, lowercase. Case is
-- preserved in what is *stored* — people write their own names — and ignored in
-- what is *compared*.
-- ---------------------------------------------------------------------------

create or replace function public.canonical_display_name(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(
    regexp_replace(
      -- NFD splits "ë" into "e" plus a combining diaeresis; the range is the
      -- combining marks block, which the next step removes.
      normalize(
        btrim(regexp_replace(value, E'[\\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000]+', ' ', 'g')),
        NFD
      ),
      -- The same enumerated class as `COMBINING_MARKS` in the domain's
      -- `display-name.ts`. Enumerated rather than a Unicode property escape
      -- because Postgres has none, and the two engines have to state one rule
      -- identically or the index stores a name the domain then refuses:
      -- Latin, Cyrillic, Hebrew points, Arabic harakat, Syriac, Thaana, and
      -- the three later combining blocks.
      E'[\u0300-\u036f\u0483-\u0489\u0591-\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20f0\ufe20-\ufe2f]', '', 'g'
    )
  );
$$;

comment on function public.canonical_display_name(text) is
  'The form two display names are compared in. Mirrors comparable() in packages/domain/src/circles/display-name.ts; the unique index depends on it.';

revoke all on function public.canonical_display_name(text) from public;
grant execute on function public.canonical_display_name(text) to anon, authenticated;

-- supabase/sql/functions/public/member_cap.sql
-- The cap, in one place. Twenty (ADR 0012); the domain's `memberLimits.max`
-- is the other copy, and `010_circles.sql` fills a circle to exactly this many.

create or replace function public.member_cap()
returns integer
language sql
immutable
set search_path = ''
as $$ select 20 $$;

comment on function public.member_cap() is
  'Maximum active members in a circle (ADR 0012). Mirrors memberLimits.max in packages/domain/src/circles/quorum.ts.';

revoke all on function public.member_cap() from public;
revoke all on function public.member_cap() from anon, authenticated;

-- supabase/sql/functions/public/soft_quorum.sql
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
set search_path = ''
as $$
  select greatest(3, greatest(2, ceil(coalesce(active_member_count, 0) * 0.6)::integer));
$$;

comment on function public.soft_quorum(integer) is
  'The quorum a plan carries while its quorum_source is defaulted: max(3, the 60% default). Mirrors softQuorum in @circles/domain (ADR 0026).';

revoke all on function public.soft_quorum(integer) from public;
revoke all on function public.soft_quorum(integer) from anon, authenticated;

-- END GENERATED: function definitions

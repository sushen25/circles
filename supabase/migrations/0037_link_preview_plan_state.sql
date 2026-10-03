-- ---------------------------------------------------------------------------
-- 0037 — The link preview says whether a plan is locked in (SUS-151, ADR 0054).
--
-- `public.preview_for_code` used to answer one `text`, the circle's name, so a
-- locked-in plan's link unfurled as "finding a time". It now answers at most one
-- row of (circle_name, plan_state), where `plan_state` is a closed enum of two
-- words, `asking` and `locked_in`. No row where it returned null before: the
-- Continue-as screen reads that as "this link isn't active", and it still does.
--
-- The return type changes, so the old function is dropped first; the grant is
-- repeated by the definition below. `MIGRATION` in `scripts/gen-sql-functions.mjs`
-- now points here.
-- ---------------------------------------------------------------------------

create type public.preview_plan_state as enum ('asking', 'locked_in');

comment on type public.preview_plan_state is
  'The only thing a link-preview card may learn about a plan besides its circle''s name (ADR 0054). Two words, never a date, a place or a person.';

drop function if exists public.preview_for_code(text, text);

-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)

-- supabase/sql/functions/public/preview_for_code.sql
-- ---------------------------------------------------------------------------
-- The circle's name, and whether its plan is locked in, for a link preview, to
-- anybody at all.
--
-- A link pasted into a group chat is fetched by WhatsApp, Messenger, Slack and
-- iMessage before a person taps it, with no session and no cookies, and the
-- card they draw is the first thing everybody in that chat sees. So this answers
-- an unauthenticated stranger — one of two functions that do, with
-- `invite_preview`, which needs the invite's secret where this needs only a code.
--
-- What it answers is the circle's **name** and one of **two words** about the
-- plan, `asking` or `locked_in` (ADR 0054, amending architecture §9.4: "circle
-- name only. Never member names, dates chosen, or anything from a quiet ask").
-- The second is an enum, not text: a card for a confirmed plan has to say it is
-- locked in, because the organiser pastes that link at the moment it is, and the
-- type is the rule that nothing more can be added without a migration and an ADR.
-- No date, no place, no person, and `ogTitle` / `ogDescription` in the domain
-- take the same care, with a title that is given the name and a description that
-- is given nothing.
--
-- Quiet asks are the case that makes the rule sharp. A quiet ask exists to hide
-- that somebody wants to organise something; a preview card naming the plan
-- would tell the whole chat, including people who are not in the circle. A quiet
-- ask is never shared by link, so it never reaches the live rule below.
--
-- **No row is what null used to be.** Unknown code, malformed code, `/join`,
-- a cancelled or expired plan, a plan long past and an archived circle all
-- answer the same: nothing. Telling them apart would let somebody walk the
-- short-code space and learn which circles exist, and the Continue-as screen
-- reads "nothing" as "this link isn't active".
-- ---------------------------------------------------------------------------

create or replace function public.preview_for_code(p_kind text, p_code text)
returns table (circle_name text, plan_state public.preview_plan_state)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `/join` carries its secret in the fragment, which is never sent to a
  -- server, so there is no code to look up and nothing to preview but the
  -- generic card. That is the property, not an oversight: the one link that
  -- grants circle membership cannot be resolved by anything that only saw the
  -- URL, this function included.
  if p_kind not in ('j', 'p') then
    return;
  end if;

  -- Shape first, so a scan with rubbish never reaches the tables. The
  -- short-code alphabet has no `i`, `l`, `o`, `0` or `1` in it.
  if p_code is null or p_code !~ '^[a-hjkmnp-z2-9]{6,12}$' then
    return;
  end if;

  -- `/j/<code>` and `/p/<code>` are the same plan seen twice — the link you
  -- paste into the chat and the page it opens (architecture §5) — so both
  -- resolve through `plans.short_code`.
  --
  -- Only while the code is live (ADR 0049, `private.circles_open_to_continue_as`):
  -- the same answer a code that never existed gets, so a cancelled or expired
  -- plan, an archived circle and a plan whose meetup is long past all draw the
  -- generic card — and the Continue-as screen, which asks this for its title,
  -- reads that as "this link isn't active". A live plan is `locked_in` once it is
  -- confirmed (or completed, within the same window, whose confirmation that
  -- rule already requires to be active or completed), and `asking` before.
  return query
  select c.name,
         case when p.state in ('confirmed', 'completed')
              then 'locked_in'::public.preview_plan_state
              else 'asking'::public.preview_plan_state end
  from public.plans p
  join public.circles c on c.id = p.circle_id
  where p.short_code = p_code
    and c.id in (select private.circles_open_to_continue_as(p_code));
end;
$$;

comment on function public.preview_for_code(text, text) is
  'The circle name behind a plan short code and whether the plan is locked in (asking or locked_in), for a link-preview card; no row for anything else. Answers an unauthenticated stranger, knowing only a short code; it returns a name and a two-word enum and nothing a plan could add to (ADR 0054, architecture §9.4).';

revoke all on function public.preview_for_code(text, text) from public;
grant execute on function public.preview_for_code(text, text) to anon, authenticated, service_role;

-- END GENERATED: function definitions

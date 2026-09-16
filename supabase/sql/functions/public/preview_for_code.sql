-- ---------------------------------------------------------------------------
-- The circle's name, for a link preview, to anybody at all.
--
-- A link pasted into a group chat is fetched by WhatsApp, Messenger, Slack and
-- iMessage before a person taps it, with no session and no cookies, and the
-- card they draw is the first thing everybody in that chat sees. So this answers
-- an unauthenticated stranger — one of two functions that do, with
-- `invite_preview`, which needs the invite's secret where this needs only a code.
--
-- What it answers is the circle's **name** and nothing else (architecture §9.4:
-- "circle name only. Never member names, dates chosen, or anything from a quiet
-- ask"). Not a signature that could carry more later, either: the return is one
-- `text`, so there is no field for a plan's title to be added to in six months
-- by somebody who did not read this comment. `ogTitle(circleName)` in the
-- domain takes the same care with the same reasoning.
--
-- Quiet asks are the case that makes the rule sharp. A quiet ask exists to hide
-- that somebody wants to organise something; a preview card naming the plan
-- would tell the whole chat, including people who are not in the circle.
--
-- Unknown code and archived circle answer the same as a code that never
-- existed: null. Telling them apart would let somebody walk the short-code
-- space and learn which circles exist.
-- ---------------------------------------------------------------------------

create or replace function public.preview_for_code(p_kind text, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  circle_name text;
begin
  -- `/join` carries its secret in the fragment, which is never sent to a
  -- server, so there is no code to look up and nothing to preview but the
  -- generic card. That is the property, not an oversight: the one link that
  -- grants circle membership cannot be resolved by anything that only saw the
  -- URL, this function included.
  if p_kind not in ('j', 'p') then
    return null;
  end if;

  -- Shape first, so a scan with rubbish never reaches the tables. The
  -- short-code alphabet has no `i`, `l`, `o`, `0` or `1` in it.
  if p_code is null or p_code !~ '^[a-hjkmnp-z2-9]{6,12}$' then
    return null;
  end if;

  -- `/j/<code>` and `/p/<code>` are the same plan seen twice — the link you
  -- paste into the chat and the page it opens (architecture §5) — so both
  -- resolve through `plans.short_code` and both answer with the circle's name.
  select c.name into circle_name
  from public.plans p
  join public.circles c on c.id = p.circle_id
  where p.short_code = p_code and c.status = 'active';

  return circle_name;
end;
$$;

comment on function public.preview_for_code(text, text) is
  'The circle name behind a plan or invite short code, for a link-preview card, or null. Answers an unauthenticated stranger, knowing only a short code; it returns a name and has no field anything else could be added to (architecture §9.4).';

revoke all on function public.preview_for_code(text, text) from public;
grant execute on function public.preview_for_code(text, text) to anon, authenticated, service_role;

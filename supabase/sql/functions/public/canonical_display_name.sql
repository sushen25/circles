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

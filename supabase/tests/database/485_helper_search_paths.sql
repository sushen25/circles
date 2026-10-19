-- SUS-192: the four small `language sql` helpers pin their search_path, and
-- still answer what they answered before.

begin;
select plan(8);

select is(
  (select proconfig from pg_proc where oid = 'public.member_cap()'::regprocedure),
  array['search_path=""'],
  'member_cap pins an empty search_path'
);
select is(
  (select proconfig from pg_proc where oid = 'public.canonical_display_name(text)'::regprocedure),
  array['search_path=""'],
  'canonical_display_name pins an empty search_path'
);
select is(
  (select proconfig from pg_proc where oid = 'public.soft_quorum(integer)'::regprocedure),
  array['search_path=""'],
  'soft_quorum pins an empty search_path'
);
select is(
  (select proconfig from pg_proc where oid = 'planning.allowed_keys(text)'::regprocedure),
  array['search_path=""'],
  'allowed_keys pins an empty search_path'
);

-- With nothing on the path they still resolve everything they use.
select is(public.member_cap(), 20, 'member_cap is still twenty');
select is(
  public.canonical_display_name(E'  Zoë   Smith '),
  'zoe smith',
  'canonical_display_name still folds case, whitespace and diacritics'
);
select is(
  array[public.soft_quorum(1), public.soft_quorum(6), public.soft_quorum(12)],
  array[3, 4, 8],
  'soft_quorum still floors at three and follows 60 percent'
);
select is(
  planning.allowed_keys('cancel'),
  array['cancel_note'],
  'allowed_keys still names the keys an action may carry'
);

select * from finish();
rollback;

-- `pg_timezone_names` and `Intl.DateTimeFormat` are not the same set, in both
-- directions, and the client validates with `Intl` (`packages/contracts/src/time.ts`):
--
--   * Postgres accepts `Factory` and the whole `posix/…` and `right/…` families,
--     which `Intl` refuses. Storing one means every member of that circle gets
--     a crash where a time should be.
--   * `Intl` accepts `australia/melbourne`; an exact-match lookup here refuses
--     it, so a contract-valid zone would be rejected at the database.
--
-- So: match case-insensitively, refuse the compatibility families, and store
-- the canonical spelling. `010_circles.sql` asserts that those families are the
-- *only* disagreement in this tzdata, so a future one is a failing test rather
-- than a surprise.

create or replace function public.enforce_iana_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  supplied text := row_to_json(new) ->> tg_argv[0];
  canonical text;
begin
  select z.name into canonical
  from pg_catalog.pg_timezone_names z
  where lower(z.name) = lower(supplied)
    and z.name not like 'posix/%'
    and z.name not like 'right/%'
    and z.name <> 'Factory'
  order by z.name
  limit 1;

  if canonical is null then
    raise exception '% is not an IANA time zone', supplied using errcode = 'check_violation';
  end if;

  -- Stored in the spelling the tz database uses, so every reader gets a name
  -- their own runtime recognises.
  new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], canonical));
  return new;
end;
$$;

comment on function public.enforce_iana_zone() is
  'Rejects a time zone the database does not know. A trigger rather than a check because pg_timezone_names is not immutable.';

revoke all on function public.enforce_iana_zone() from public;
revoke all on function public.enforce_iana_zone() from anon, authenticated;

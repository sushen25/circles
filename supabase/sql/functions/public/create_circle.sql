-- ---------------------------------------------------------------------------
-- create_circle
--
-- The only way a circle comes into existence. A definer function rather than an
-- insert policy, because a circle and its owner's membership have to appear
-- together — an insert policy would leave a window in which a circle exists
-- with no members and therefore no one who can see it.
--
-- The invite link is here for the same reason, one step further out. Spec §5.1
-- makes the circle and the link one step of one flow, and `create-circle` used
-- to make them with two RPCs: a failure between them left a circle nobody could
-- be invited to, a `circles.circle_created` event about it, and a person looking
-- at an error message. Given a digest, the link is issued in this transaction,
-- so the answer to "did that work?" is the same answer for both.
-- ---------------------------------------------------------------------------

create or replace function public.create_circle(
  name text,
  color text,
  time_zone text,
  -- Required, and therefore ahead of the optional cadence. §9.1 has every
  -- mutation idempotent on a client-supplied key, and an optional one is a key
  -- nobody sends: the retry it guards against is the one where the client never
  -- saw a response and cannot tell a timeout from a failure.
  idempotency_key text,
  cadence text default 'none',
  -- SHA-256 of the invite secret, which the server never sees (§14). Optional
  -- because a circle is a circle without a link — fixtures and tests make them
  -- that way — and passed by `create-circle` always, because the flow it serves
  -- promises both.
  invite_secret_hash bytea default null,
  -- The invite's id, when the secret was derived from it (ADR 00XX): what lets
  -- the owner be shown this link again. Absent, the link is issued with an id
  -- of its own and can only ever be reset.
  invite_id uuid default null,
  -- "Where, roughly" on CreateCircle (S1-23): a loose area, optional. Blank is
  -- no answer, not an empty place.
  default_area text default null
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The `ShortCode` contract's alphabet (`packages/contracts/src/ids.ts`).
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  caller uuid := (select auth.uid());
  caller_name text;
  created public.circles;
  code text;
  i integer;
begin
  if not public.auth_is_permanent() then
    -- The organiser gate (ADR 0004). Worded as a practical need by the client;
    -- here it is simply a refusal.
    raise exception 'creating a circle needs a saved place'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(create_circle.idempotency_key), '') = '' then
    raise exception 'create_circle needs an idempotency key'
      using errcode = 'null_value_not_allowed';
  end if;

  -- A retry returns what the first attempt made. Creating a circle is the one
  -- mutation where a lost response is expensive: the client cannot tell a
  -- timeout from a failure, and trying again would leave the person with two
  -- circles and no way to tell which one they gave the link out for.
  select * into created
  from public.circles c
  where c.owner_user_id = caller and c.creation_key = create_circle.idempotency_key;
  if found then
    return created;
  end if;

  select p.display_name into caller_name from public.profiles p where p.user_id = caller;
  if caller_name is null then
    raise exception 'no profile for %', caller using errcode = 'foreign_key_violation';
  end if;

  -- Ten characters from the `ShortCode` alphabet — no `0`/`o`, no `1`/`l`/`i`,
  -- because a short code is read aloud and retyped. Not a secret and not
  -- required to be unguessable: the invite secret is the capability, and it
  -- never reaches a server (§14). The loop retries on collision rather than
  -- hoping there is none.
  loop
    code := '';
    for i in 1..10 loop
      code := code || substr(
        alphabet,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)),
        1
      );
    end loop;
    exit when not exists (select 1 from public.circles c where c.short_code = code);
  end loop;

  insert into public.circles
    (owner_user_id, name, color, time_zone, cadence, short_code, creation_key, default_area)
  values (caller, create_circle.name, create_circle.color, create_circle.time_zone,
          create_circle.cadence, code, create_circle.idempotency_key,
          nullif(btrim(create_circle.default_area), ''))
  returning * into created;

  insert into public.circle_members (circle_id, user_id, display_name_snapshot, role)
  values (created.id, caller, caller_name, 'owner');

  -- The link, in the same transaction, through the function that owns what
  -- issuing one means: the audit row, the revocation of any earlier link, and
  -- the rule that the first link announces nothing because the circle's own
  -- creation already did. It checks that the caller owns the circle, which they
  -- do — they are two statements away from having made it.
  if create_circle.invite_secret_hash is not null then
    perform public.issue_invite(
      created.id, create_circle.invite_secret_hash, create_circle.invite_id
    );
  end if;

  -- `circles.circle_created` and `circles.member_joined` are written to
  -- `jobs.outbox` by the row triggers in 0006, in this transaction — on the
  -- rows rather than here, so that every writer of a circle or a membership
  -- announces it, not only this function.

  return created;

exception
  when unique_violation then
    -- Two identical requests in flight at once: the index caught the second, and
    -- the row the first one wrote is the answer.
    select * into created
    from public.circles c
    where c.owner_user_id = caller and c.creation_key = create_circle.idempotency_key;
    if found then
      return created;
    end if;
    raise;
end;
$$;

comment on function public.create_circle(text, text, text, text, text, bytea, uuid, text) is
  'Creates a circle, its owner membership and — given a digest — its invite link, in one transaction. Requires a permanent identity (ADR 0004).';

revoke all on function public.create_circle(text, text, text, text, text, bytea, uuid, text) from public;
revoke all on function public.create_circle(text, text, text, text, text, bytea, uuid, text) from anon, authenticated;
grant execute on function public.create_circle(text, text, text, text, text, bytea, uuid, text) to authenticated;

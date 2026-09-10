-- Identity and circles: the authorisation root.
--
-- Everything downstream asks one question — "is this person an active member of
-- that circle?" — and every table in Slice 1 answers it with `auth_is_member`.
-- That is why this migration is worth reading slowly: a mistake here is not a
-- bug in one screen, it is a circle's plans visible to somebody who left it.
--
-- Three rules shape the whole file (architecture §8.4, §14):
--
--   1. Default deny. RLS is on, and a table with no policy for an operation
--      refuses that operation. Nothing relies on a client behaving.
--   2. Writes that touch more than one row go through `security definer`
--      functions, so the invariants — an owner is a member, a circle has at
--      most twelve — hold in one transaction rather than across two requests.
--   3. Anonymous identities may join, answer and attend, and may not create
--      (ADR 0004). That is a **restrictive** policy, not the absence of a
--      permissive one, so a future permissive policy cannot open the gate by
--      accident.

-- ---------------------------------------------------------------------------
-- profiles
--
-- One row per `auth.users` row, created by a trigger rather than by the client:
-- a guest answering an invite has no app and no sign-up form, and the profile
-- has to exist by the time their membership does.
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  -- IANA name, not an offset. Every wall-clock rule in the domain needs the
  -- zone itself, because an offset cannot answer "what is 8 am there in April".
  time_zone text not null default 'UTC',
  -- Apple, Google or an email code — not an anonymous session. The organiser
  -- gate reads the JWT rather than this column (a claim cannot be edited by the
  -- row's owner), and this is the durable record of the same fact.
  is_permanent boolean not null default false,
  -- Set the first time the native app reports in. Null means web-only, which
  -- is what decides whether an organiser is emailed or pushed (review C6).
  app_installed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 40)
);

comment on table public.profiles is
  'One row per auth user. Created by handle_new_user(); display_name is the only column other members may see, through public.member_profiles.';

-- ---------------------------------------------------------------------------
-- circles
-- ---------------------------------------------------------------------------

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id),
  name text not null,
  -- A token name ('sky'), never a hex value: the palette is generated from the
  -- design source and a stored hex would outlive the token it came from.
  color text not null,
  time_zone text not null,
  cadence text not null default 'none',
  -- Null means "work it out from the member count" — `effectiveNudgePolicy` in
  -- the domain. A default written here would freeze the answer at creation,
  -- when the circle has one member and the answer is always 'owner'.
  nudge_policy text,
  default_duration_minutes integer not null default 120,
  -- Null means "compute it from the active member count" (`quorumDefault`).
  default_quorum integer,
  default_area text,
  status text not null default 'active',
  -- Moved only by a reported-happened outcome. Null means the circle has never
  -- met, which is a different sentence on circle home from "no rush".
  last_met_at timestamptz,
  cadence_snoozed_until timestamptz,
  -- The `/join` path segment. Carries no secret; the invite secret rides in the
  -- URL fragment and is never sent to a server (§14).
  short_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint circles_name_length check (char_length(name) between 1 and 40),
  constraint circles_status check (status in ('active', 'archived')),
  constraint circles_cadence check (
    cadence in ('weekly', 'fortnightly', 'monthly', 'two_monthly', 'none')
  ),
  constraint circles_nudge_policy check (
    nudge_policy is null or nudge_policy in ('last_organiser', 'take_turns', 'owner')
  ),
  constraint circles_default_duration check (default_duration_minutes in (60, 90, 120, 180)),
  -- Two is the floor the domain's `quorumDefault` never goes below: a meetup of
  -- one is not a meetup.
  constraint circles_default_quorum check (default_quorum is null or default_quorum >= 2)
);

comment on table public.circles is
  'A small private group. The authorisation root: every other table reaches its circle to decide who may see a row.';

-- ---------------------------------------------------------------------------
-- circle_members
--
-- `removed` keeps the row rather than deleting it (spec §5.2): a confirmed
-- meetup's attendance history has to survive somebody leaving, and the display
-- name is snapshotted for the same reason.
-- ---------------------------------------------------------------------------

create table public.circle_members (
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name_snapshot text not null,
  role text not null default 'member',
  status text not null default 'active',
  joined_at timestamptz not null default now(),
  muted_quiet_asks boolean not null default false,
  muted_all boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (circle_id, user_id),
  constraint circle_members_role check (role in ('owner', 'member')),
  constraint circle_members_status check (status in ('active', 'removed'))
);

comment on table public.circle_members is
  'Membership, and the authorisation fact every RLS policy in the product is written against.';

-- `auth_is_member` runs on every policy evaluation, so its lookup is by
-- (circle_id, user_id) — the primary key. This one is for the other direction:
-- "which circles am I in", the query circle list makes on every app open.
create index circle_members_user_id_idx on public.circle_members (user_id);
create index circle_members_active_idx on public.circle_members (circle_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- circle_invites
--
-- The secret itself is never stored — only its SHA-256 (§14). Rotating means
-- writing a new row and revoking the old, which invalidates the link without
-- disturbing anybody who already joined.
-- ---------------------------------------------------------------------------

create table public.circle_invites (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  secret_hash bytea not null,
  created_by uuid not null references auth.users (id),
  revoked_at timestamptz,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.circle_invites is
  'Hashed invite secrets. No client role has any privilege here: redemption goes through a definer function (S1-13).';

-- One live link per circle. A partial unique index rather than a trigger,
-- because "at most one" is a shape the database can hold by itself.
create unique index circle_invites_one_live_idx
  on public.circle_invites (circle_id)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger circles_touch_updated_at
  before update on public.circles
  for each row execute function public.touch_updated_at();
create trigger circle_members_touch_updated_at
  before update on public.circle_members
  for each row execute function public.touch_updated_at();
create trigger circle_invites_touch_updated_at
  before update on public.circle_invites
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The member cap, and the owner's membership.
--
-- Both are triggers rather than checks because both are statements about a
-- table, not about a row.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_member_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_count integer;
begin
  if new.status <> 'active' then
    return new;
  end if;

  -- `for update` on the circle serialises concurrent joins: two people
  -- redeeming the last seat at once would otherwise both count eleven.
  perform 1 from public.circles where id = new.circle_id for update;

  select count(*) into active_count
  from public.circle_members
  where circle_id = new.circle_id
    and status = 'active'
    and (tg_op = 'INSERT' or user_id <> new.user_id);

  if active_count >= 12 then
    raise exception 'circle % already has the maximum of 12 active members', new.circle_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_member_cap() is
  'Member cap of 12 (spec §5.2). A trigger rather than a check because the rule is about the table, not the row.';

create trigger circle_members_cap
  before insert or update of status on public.circle_members
  for each row execute function public.enforce_member_cap();

create or replace function public.enforce_owner_is_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.circle_members
    where circle_id = new.id
      and user_id = new.owner_user_id
      and status = 'active'
  ) then
    raise exception 'circle % owner % must be an active member', new.id, new.owner_user_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_owner_is_member() is
  'The owner is a member (architecture §8.2). Deferred to the end of the transaction so create_circle can insert the circle and the membership in either order.';

-- Constraint trigger so it fires at commit: `create_circle` writes the circle
-- first and the membership second, and an immediate check would fail on a row
-- that is correct one statement later.
create constraint trigger circles_owner_is_member
  after insert or update of owner_user_id on public.circles
  deferrable initially deferred
  for each row execute function public.enforce_owner_is_member();

-- ---------------------------------------------------------------------------
-- The signup trigger.
--
-- `is_permanent` is derived from the auth row rather than trusted from a
-- client: an anonymous session that could set its own flag would walk straight
-- through the organiser gate.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, time_zone, is_permanent)
  values (
    new.id,
    -- A name the person gave, if they gave one. Never an email address or any
    -- part of one: display names are shown to the whole circle (§14).
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Guest'),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'time_zone'), ''), 'UTC'),
    not coalesce((new.raw_app_meta_data ->> 'is_anonymous')::boolean, false)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the profile for a new auth user, with is_permanent derived from the auth row rather than supplied by the client.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- The authorisation helpers.
--
-- Every one is `security definer` with an empty `search_path` and revoked from
-- `public` (§14). The empty search path is not decoration: a definer function
-- that resolves an unqualified name through the caller's path can be pointed at
-- a table the caller controls.
-- ---------------------------------------------------------------------------

create or replace function public.auth_is_member(circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.circle_members m
    where m.circle_id = auth_is_member.circle_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

comment on function public.auth_is_member(uuid) is
  'True when the caller is an active member of the circle. The select policy on every circle-scoped table in the product.';

create or replace function public.auth_is_owner(circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.circles c
    join public.circle_members m
      on m.circle_id = c.id
     and m.user_id = c.owner_user_id
     and m.status = 'active'
    where c.id = auth_is_owner.circle_id
      and c.owner_user_id = (select auth.uid())
  );
$$;

comment on function public.auth_is_owner(uuid) is
  'True when the caller owns the circle and is still an active member of it. An owner who left owns nothing.';

create or replace function public.auth_is_permanent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Signed in, and not anonymous. Read from the JWT rather than from
  -- `profiles`, because a row the caller can update is not a credential.
  --
  -- A missing claim reads as anonymous. That is the safe direction: the only
  -- thing this gates is creation, and refusing a permanent user is a retry
  -- while admitting an anonymous one strands a plan (ADR 0004).
  select (select auth.uid()) is not null
     and coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous',
           'true'
         ) = 'false';
$$;

comment on function public.auth_is_permanent() is
  'True when the caller has a saved place (Apple, Google or email code). Gates circle and plan creation (ADR 0004). A missing claim reads as anonymous.';

revoke all on function public.auth_is_member(uuid) from public;
revoke all on function public.auth_is_owner(uuid) from public;
revoke all on function public.auth_is_permanent() from public;
grant execute on function public.auth_is_member(uuid) to anon, authenticated;
grant execute on function public.auth_is_owner(uuid) to anon, authenticated;
grant execute on function public.auth_is_permanent() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_circle
--
-- The only way a circle comes into existence. A definer function rather than an
-- insert policy, because a circle and its owner's membership have to appear
-- together — an insert policy would leave a window in which a circle exists
-- with no members and therefore no one who can see it.
-- ---------------------------------------------------------------------------

create or replace function public.create_circle(
  name text,
  color text,
  time_zone text,
  cadence text default 'none'
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_name text;
  created public.circles;
  code text;
begin
  if not public.auth_is_permanent() then
    -- The organiser gate (ADR 0004). Worded as a practical need by the client;
    -- here it is simply a refusal.
    raise exception 'creating a circle needs a saved place'
      using errcode = 'insufficient_privilege';
  end if;

  select p.display_name into caller_name from public.profiles p where p.user_id = caller;
  if caller_name is null then
    raise exception 'no profile for %', caller using errcode = 'foreign_key_violation';
  end if;

  -- 8 characters of base32-ish alphabet from 5 random bytes. Not a secret and
  -- not required to be unguessable — the invite secret is the capability, and
  -- it never reaches a server (§14). The unique index is what makes the retry
  -- loop terminate honestly rather than a hope about collisions.
  loop
    code := lower(encode(extensions.gen_random_bytes(5), 'hex'));
    exit when not exists (select 1 from public.circles c where c.short_code = code);
  end loop;

  insert into public.circles (owner_user_id, name, color, time_zone, cadence, short_code)
  values (caller, create_circle.name, create_circle.color, create_circle.time_zone,
          create_circle.cadence, code)
  returning * into created;

  insert into public.circle_members (circle_id, user_id, display_name_snapshot, role)
  values (created.id, caller, caller_name, 'owner');

  -- TODO(S1-11): write `circles.circle_created` and `circles.member_joined` to
  -- `jobs.outbox` here, in this transaction. The table does not exist yet, and
  -- `020_outbox_dependency.sql` fails the build the day it does — so this
  -- cannot be forgotten rather than merely noted.

  return created;
end;
$$;

comment on function public.create_circle(text, text, text, text) is
  'Creates a circle and its owner membership in one transaction. Requires a permanent identity (ADR 0004).';

revoke all on function public.create_circle(text, text, text, text) from public;
grant execute on function public.create_circle(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- member_profiles
--
-- Current display names for the people you share a circle with, and nothing
-- else about them.
--
-- `circle_members.display_name_snapshot` is the name history keeps; this is the
-- name they go by now. The view is deliberately **not** `security_invoker`: RLS
-- is row-level, so a policy permissive enough to expose a name would expose the
-- time zone and install date beside it. The membership filter below is the
-- policy, written where it can be column-limited.
-- ---------------------------------------------------------------------------

create view public.member_profiles as
select p.user_id, p.display_name
from public.profiles p
where exists (
  select 1
  from public.circle_members mine
  join public.circle_members theirs on theirs.circle_id = mine.circle_id
  where mine.user_id = (select auth.uid())
    and mine.status = 'active'
    and theirs.user_id = p.user_id
    and theirs.status = 'active'
);

comment on view public.member_profiles is
  'user_id and display_name for people the caller shares an active circle with. Definer by design: the column limit is the point, and RLS cannot express one.';

revoke all on public.member_profiles from anon, authenticated;
grant select on public.member_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- On for all four tables, and default deny: an operation with no policy is
-- refused. Every policy below is written for one operation, so adding a
-- capability means adding a policy rather than widening one.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_invites enable row level security;

-- profiles: your own row, and only the columns you would expect. Other
-- people's names come through `member_profiles`.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No insert policy: profiles are created by `handle_new_user()`. No delete
-- policy: an account is removed through `delete-account` (§14), which
-- anonymises memberships rather than dropping rows.

-- circles: visible to members. Never inserted by a client.
create policy circles_select_member on public.circles
  for select to authenticated
  using (public.auth_is_member(id));

create policy circles_update_owner on public.circles
  for update to authenticated
  using (public.auth_is_owner(id))
  with check (public.auth_is_owner(id));

-- ADR 0004, as a restrictive policy rather than as the absence of a permissive
-- one. There is no insert policy on `circles` today; if somebody adds one, this
-- still refuses an anonymous caller.
create policy circles_no_anonymous_insert on public.circles
  as restrictive
  for insert to anon, authenticated
  with check (public.auth_is_permanent());

-- circle_members: members see the roster of circles they belong to, and may
-- change their own mute settings. Joining and leaving go through functions.
create policy circle_members_select_member on public.circle_members
  for select to authenticated
  using (public.auth_is_member(circle_id));

create policy circle_members_update_own on public.circle_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- circle_invites: nothing. Not a narrow policy — no policy at all, plus an
-- explicit revoke, because the secret hash is the one thing in this schema
-- worth stealing.
revoke all on public.circle_invites from anon, authenticated;

-- And nothing created in `public` from here on arrives readable either. The
-- default privileges Supabase ships grant `all` on new tables to both client
-- roles, which makes "default deny" false for every table the next migration
-- writes unless it remembers to revoke. It should not have to remember.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- RLS decides which *rows*; these decide which *columns*, and the two together
-- are what "default deny" means here.
--
-- Column-level update grants rather than restrictive policies comparing the new
-- row to the stored one. That was the first attempt and it was wrong twice
-- over: a policy on `profiles` that reads `profiles` recurses infinitely — the
-- test caught it — and even where it works, a `with check` subquery is an
-- invariant expressed in a place nothing else can see. A grant appears in
-- `\dp`, is checked before RLS, and cannot recurse.
--
-- What is *not* granted is the point of each line:
--
--   profiles         `is_permanent` is derived from the auth row (a saved place
--                    is not something you award yourself), and `user_id` is the
--                    key.
--   circles          `owner_user_id` — a hand-off is its own operation with its
--                    own checks; `short_code` — the link people already have;
--                    `last_met_at` — moved only by a reported-happened outcome.
--   circle_members   everything but the two mute flags: `role` would be
--                    self-promotion, `status` self-reinstatement, and
--                    `display_name_snapshot` is the name history keeps.
-- ---------------------------------------------------------------------------

-- Revoke first. Supabase's default privileges grant `all` on every new table in
-- `public` to `anon` and `authenticated`, so a table created here arrives fully
-- granted and the lines below would only *add* to that. Without these three
-- revokes the column lists above are decoration — which is exactly what the
-- tests found when they were not here.
revoke all on public.profiles from anon, authenticated;
revoke all on public.circles from anon, authenticated;
revoke all on public.circle_members from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, time_zone, app_installed_at) on public.profiles to authenticated;

grant select on public.circles to authenticated;
grant update (
  name, color, time_zone, cadence, nudge_policy,
  default_duration_minutes, default_quorum, default_area,
  status, cadence_snoozed_until
) on public.circles to authenticated;

grant select on public.circle_members to authenticated;
grant update (muted_quiet_asks, muted_all) on public.circle_members to authenticated;

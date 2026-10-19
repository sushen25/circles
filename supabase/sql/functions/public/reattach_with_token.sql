-- ---------------------------------------------------------------------------
-- reattach_with_token — the emailed way back
--
-- The token form of reattachment (ADR 0006, §10): a guest follows the `/a/<token>`
-- link from an email and this moves their membership onto the session they hold.
--
-- **The service role's, and nobody else's.** The table keeps only a digest of
-- the token, so if the digest were enough to call this, a copy of
-- `private.email_action_tokens` (a backup, an export, a read-only SQL user)
-- would be a set of working re-entries, some able to take places back from
-- saved accounts (ADR 0049, decision 6). So the `reattach-member` Edge Function
-- hashes the token it was sent and passes the digest with the caller it
-- verified from the JWT: the same shape as `join_from_plan` and
-- `claim_identity`. Why the digest is computed there and not in SQL: handing
-- this function the token itself would put the capability in a statement
-- parameter, which is what architecture §14 keeps out of query logs.
--
-- **The digest is an HMAC under a key only the Edge Function holds** (SUS-214,
-- ADR 0081): the table cannot be turned into a digest by anybody who has the
-- table alone. `p_legacy_token_hash` is the plain SHA-256 of the same token, for
-- a link emailed before that change; it finds only a row stored as `sha256`
-- (`email_action_tokens.digest_kind`), and no row made since is stored that way.
-- A re-entry link lasts seven days, so the legacy digest has no use after the
-- seventh day and is removed then.
--
-- `p_user_id` is who is coming back. It can be trusted because only the service
-- role can say it, and the Edge Function takes it from the verified JWT, never
-- from the body. The JWT is not read here: the service role's is not the
-- person's, so the stale-token check in the core relies on the two database
-- records alone, which are current.
-- ---------------------------------------------------------------------------

create or replace function public.reattach_with_token(
  p_user_id uuid,
  p_reentry_token_hash bytea,
  p_legacy_token_hash bytea default null
)
returns public.circles
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'reattach_with_token requires the person coming back'
      using errcode = 'insufficient_privilege';
  end if;

  return private.reattach_member_core(
    p_user_id, null, null, p_reentry_token_hash, p_legacy_token_hash
  );
end;
$$;

comment on function public.reattach_with_token(uuid, bytea, bytea) is
  'Moves a guest membership onto p_user_id from an emailed re-entry token digest (ADR 0006, ADR 0049). Service role only: the digest is stored, so it must not be a way in by itself, and the reattach-member Edge Function that hashes the token passes the caller it verified. The digest is an HMAC under a key the database does not hold; p_legacy_token_hash finds only a token stored before that (ADR 0081).';

revoke all on function public.reattach_with_token(uuid, bytea, bytea) from public;
revoke all on function public.reattach_with_token(uuid, bytea, bytea) from anon, authenticated;
grant execute on function public.reattach_with_token(uuid, bytea, bytea) to service_role;

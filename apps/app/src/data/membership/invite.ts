import {
  InvitePreview,
  JoinLink,
  RedeemInviteResponse,
  type IdempotencyKey,
} from '@circles/contracts';

import { authClient } from '../auth/client';
import { ensureGuestSession } from '../auth/guest';
import { getTurnstileToken } from '../auth/turnstile';
import { invokeFunction } from '../functions';

/**
 * A circle invite: `/join#<secret>` (architecture §5.2, spec §5.1).
 *
 * The secret is the capability — whoever holds it can join — and the fragment
 * is where it lives precisely because a fragment never reaches a server. Every
 * function here is written to keep it that way: it is read from the hash, held
 * in memory for the length of the join, hashed before the only database call
 * that needs to find it, and sent in a request *body* once, to `redeem-invite`.
 * It is never put in a URL, a query key, storage, a log or an analytics payload.
 */

/**
 * The secret out of `location.hash`, or null for a link with none or a mangled
 * one. Null rather than a throw: a truncated link pasted from a chat is an
 * ordinary thing to arrive with, and the screen says so plainly.
 */
export function inviteSecretFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const parsed = JoinLink.safeParse({ secret: decoded });
  return parsed.success ? parsed.data.secret : null;
}

/**
 * SHA-256 of the secret, in the form PostgREST takes a `bytea` in.
 *
 * Hashed in the browser so the secret is never a statement parameter, which is
 * the same care `redeem-invite` takes server-side (§14). Web Crypto only exists
 * in a secure context; `localhost` counts, so development and the e2e suite are
 * unaffected. Native has no `crypto.subtle` — invite links open in the app from
 * Slice 3 (S3-01), which will need a digest from `expo-crypto`.
 */
export async function secretDigest(secret: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('no Web Crypto available to hash the invite');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
  return `\\x${hex.join('')}`;
}

/**
 * What the Join page shows before joining, or null when the link is not live.
 *
 * Null covers revoked, unknown and archived alike — the database will not say
 * which, and neither will the screen.
 */
export async function fetchInvitePreview(secret: string): Promise<InvitePreview | null> {
  const { data, error } = await authClient().rpc('invite_preview', {
    p_secret_hash: await secretDigest(secret),
  });
  if (error !== null) throw new Error('invite preview failed');
  const row = (data ?? [])[0];
  return row === undefined ? null : InvitePreview.parse(row);
}

export interface RedeemOptions {
  secret: string;
  displayName: string;
  /** The same key for a retry of the same name; a new one when the name changes. */
  idempotencyKey: IdempotencyKey;
}

/**
 * Joins the circle behind `secret` under `displayName`.
 *
 * The session comes first and is idempotent, so calling this without one is
 * safe; calling it with one — the guest who tapped "Choose my times" a moment
 * ago — reuses it rather than minting a second identity that would strand the
 * first.
 *
 * Turnstile gets its **own** token. One token cannot satisfy both Supabase
 * Auth's captcha and `redeem-invite`'s check, and `undefined` is an honest
 * answer on a build with no site key (§14: Turnstile is not load-bearing).
 */
export async function redeemInvite({
  secret,
  displayName,
  idempotencyKey,
}: RedeemOptions): Promise<RedeemInviteResponse> {
  await ensureGuestSession();
  const turnstileToken = await getTurnstileToken();

  return await invokeFunction(
    'redeem-invite',
    {
      idempotency_key: idempotencyKey,
      secret,
      display_name: displayName,
      ...(turnstileToken === undefined ? {} : { turnstile_token: turnstileToken }),
    },
    RedeemInviteResponse,
  );
}

/**
 * The invite this tab is in the middle of using.
 *
 * In memory and nowhere else. `/join` strips the fragment from the address bar
 * as soon as it has read it, so the Name step — a separate route, for the back
 * button — cannot read it back from the URL, and writing a capability to
 * storage so that it could would outlive the join it was for. A reload between
 * the two steps loses it, and the person is asked to open the link again; that
 * is the cost, and it is paid rarely.
 */
let held: string | undefined;

export function holdInvite(secret: string): void {
  held = secret;
}

export function heldInvite(): string | undefined {
  return held;
}

export function releaseInvite(): void {
  held = undefined;
}

/**
 * Take an invite secret out of the address bar before the router sees it.
 *
 * Called from the app's entry point (`index.ts`), before `expo-router/entry` is
 * imported. It has to be that early: expo-router reads `window.location` when
 * its own module is first evaluated, copies the fragment into navigation state,
 * and writes it back into history on every update — so a `replaceState` from a
 * screen, or even from the root layout's module, is undone within the second.
 * The e2e suite found both. Taken here, the router never learns there was one.
 *
 * Only on `/join`, the one route whose fragment is a capability. Anywhere else
 * a fragment is left alone. Nothing on the server (no `window`).
 */
export function captureInviteFragment(): void {
  if (typeof window === 'undefined' || window.location === undefined) return;
  const { pathname, search, hash } = window.location;
  if (hash === '' || pathname.replace(/\/+$/, '') !== '/join') return;

  const secret = inviteSecretFromHash(hash);
  if (secret !== null) holdInvite(secret);
  window.history.replaceState(window.history.state, '', pathname + search);
}

import { consentFor } from '@circles/config';
import {
  ManageEmailPreferencesResponse,
  RequestEmailUpdatesRequest,
  RequestEmailUpdatesResponse,
  StopLettersResponse,
  type StopFamily,
  VerifyEmailContactResponse,
  type IdempotencyKey,
  type OpaqueToken,
  type PlanId,
} from '@circles/contracts';

import { invokeFunction } from '../functions';

/**
 * Plan-update email, from the client's side (spec §5.8, S1-18's functions).
 *
 * **What the answers do not say is deliberate.** `request-email-updates`
 * answers `check_email` whatever happened — verified already, suppressed,
 * somebody else's, never seen — so a member cannot walk a list of addresses
 * through a plan and learn which friends use the product. `verify-email-contact`
 * and `manage-email-preferences` never return the address. Screens say what
 * they can from that, and hold the address the person typed in memory only
 * (`typedAddress`), never in a URL.
 */

export interface RequestEmailUpdatesOptions {
  planId: string;
  email: string;
  /** A new one for every tap: a resend with the old key replays and sends nothing. */
  idempotencyKey: IdempotencyKey;
  /**
   * Whether the sentence the person saw was the account one: they have an
   * account or the "Save my place" switch was on. The version recorded is the
   * one for the words on the card (`consentFor`), never the server's today.
   */
  account: boolean;
}

export async function requestEmailUpdates({
  planId,
  email,
  idempotencyKey,
  account,
}: RequestEmailUpdatesOptions): Promise<RequestEmailUpdatesResponse> {
  return await invokeFunction(
    'request-email-updates',
    {
      idempotency_key: idempotencyKey,
      plan_id: planId as PlanId,
      email,
      // The words this build rendered on the Sent card (`consentFor(account).text`):
      // what is recorded is what the person was shown, not what the server says today.
      consent_version: consentFor(account).version,
    },
    RequestEmailUpdatesResponse,
  );
}

/**
 * Load this page's copy again, after the server said it does not know the
 * consent wording this build rendered (`consent_version_unknown`): a deploy has
 * moved on, and the person should read the current sentence before agreeing to
 * it. Web only; the native build gets its copy with the build.
 */
export function canReloadCopy(): boolean {
  return typeof window !== 'undefined' && typeof window.location?.reload === 'function';
}

export function reloadCopy(): void {
  if (canReloadCopy()) window.location.reload();
}

/** `/v#<token>`: verify the address the token was sent to. No session needed. */
export async function verifyEmail(token: OpaqueToken): Promise<VerifyEmailContactResponse> {
  return await invokeFunction('verify-email-contact', { token }, VerifyEmailContactResponse);
}

/**
 * `/n#<token>`, `/o#<token>` or `/q#<token>`: stop the cadence nudge, the
 * organiser's letters or the quiet ask's letters, with no session (ADR 0067, ADR
 * 0069). Called only from the page's one button, never on load.
 */
export async function stopLetters(
  family: StopFamily,
  token: OpaqueToken,
): Promise<StopLettersResponse> {
  return await invokeFunction('stop-letters', { token, family }, StopLettersResponse);
}

export type PreferencesAction =
  { action: 'view' } | { action: 'stop_plan'; planId: string } | { action: 'remove_contact' };

/** `/e#<token>`: see, stop or remove, with no session. */
export async function managePreferences(
  token: OpaqueToken,
  request: PreferencesAction,
): Promise<ManageEmailPreferencesResponse> {
  return await invokeFunction(
    'manage-email-preferences',
    {
      token,
      action: request.action,
      ...(request.action === 'stop_plan' ? { plan_id: request.planId } : {}),
    },
    ManageEmailPreferencesResponse,
  );
}

/**
 * The address somebody just typed, for "We sent a link to …" on the next
 * screen. In memory for this tab only, and keyed by **who** typed it as well as
 * the plan: a shared tab that changes hands must not show the next person the
 * last one's address, or let them resend to it. An address is personal data and
 * does not go in a URL, a draft or storage; a reload loses it, and the screen
 * reads without it.
 */
const typed = new Map<string, { email: string; account: boolean }>();

/**
 * `account` is which sentence the card showed with it (`consentFor`), so a
 * resend from Check your email records the words the person actually saw.
 */
export function rememberTypedAddress(
  userId: string,
  planId: string,
  email: string,
  account: boolean,
): void {
  typed.set(`${userId}:${planId}`, { email, account });
}

export function typedAddress(userId: string, planId: string): string | undefined {
  return typed.get(`${userId}:${planId}`)?.email;
}

/** Whether the card that address was typed on showed the account sentence. */
export function typedAccount(userId: string, planId: string): boolean {
  return typed.get(`${userId}:${planId}`)?.account ?? false;
}

/**
 * The address as the server will read it, or null when it is not one: the
 * contract's own rule (trimmed, lower-cased, NFC, at most 254, an email), so a
 * screen never accepts what the function would refuse.
 */
export function normaliseAddress(input: string): string | null {
  const parsed = RequestEmailUpdatesRequest.shape.email.safeParse(input);
  return parsed.success ? parsed.data : null;
}

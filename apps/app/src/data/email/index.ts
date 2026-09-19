import {
  ManageEmailPreferencesResponse,
  RequestEmailUpdatesRequest,
  RequestEmailUpdatesResponse,
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
}

export async function requestEmailUpdates({
  planId,
  email,
  idempotencyKey,
}: RequestEmailUpdatesOptions): Promise<RequestEmailUpdatesResponse> {
  return await invokeFunction(
    'request-email-updates',
    { idempotency_key: idempotencyKey, plan_id: planId as PlanId, email },
    RequestEmailUpdatesResponse,
  );
}

/** `/v#<token>`: verify the address the token was sent to. No session needed. */
export async function verifyEmail(token: OpaqueToken): Promise<VerifyEmailContactResponse> {
  return await invokeFunction('verify-email-contact', { token }, VerifyEmailContactResponse);
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
const typed = new Map<string, string>();

export function rememberTypedAddress(userId: string, planId: string, email: string): void {
  typed.set(`${userId}:${planId}`, email);
}

export function typedAddress(userId: string, planId: string): string | undefined {
  return typed.get(`${userId}:${planId}`);
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

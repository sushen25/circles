import {
  DeleteAccountResponse,
  ExportMyDataResponse,
  type IdempotencyKey,
} from '@circles/contracts';

import { invokeFunction } from '../functions';
import { authClient } from './client';
import { signOut } from './session';

/**
 * The account's own controls (spec §13; S4-05, ADR 0083): what deleting would
 * do, deleting, and downloading what we hold.
 *
 * Nothing here is kept: the export is handed to the caller to save and the
 * module holds none of it, and nothing in it is logged.
 */

/** A circle the caller owns, and who it would go to when they delete. */
export interface OwnedCircle {
  circleId: string;
  name: string;
  /** The longest-standing permanent member, or null when it would be archived. */
  heirName: string | null;
}

export async function deletionPreview(): Promise<OwnedCircle[]> {
  const { data, error } = await authClient().rpc('account_deletion_preview');
  if (error !== null) throw new Error('deletion preview failed');
  return (data ?? []).map((row) => ({
    circleId: row.circle_id,
    name: row.circle_name,
    heirName: row.heir_display_name,
  }));
}

/**
 * Deletes the account, then leaves this device signed out whatever the network
 * does: the server has already revoked the session, so the global sign-out
 * `signOut()` tries first may be refused and it falls back to the local one,
 * which is the point of reusing it.
 *
 * The key is the caller's, held for the sheet's life. A retry after a lost
 * response may be refused as signed out, because the session really is gone;
 * the screen then says it could not delete, and signing in is refused if it did.
 */
export async function deleteMyAccount(
  idempotencyKey: IdempotencyKey,
): Promise<{ handedOn: number; archived: number }> {
  const done = await invokeFunction(
    'delete-account',
    { idempotency_key: idempotencyKey, confirm: true },
    DeleteAccountResponse,
  );
  try {
    await signOut();
  } catch {
    // The account is gone and its tokens are dead; a device that could not
    // clear its own copy still cannot do anything with it.
  }
  return { handedOn: done.circles_handed_on, archived: done.circles_archived };
}

/** The caller's data as a file to save. One a day: `too_many_requests` after that. */
export async function exportMyData(): Promise<{ filename: string; contents: string }> {
  const done = await invokeFunction('export-my-data', {}, ExportMyDataResponse);
  return { filename: done.filename, contents: JSON.stringify(done.data, null, 2) };
}

import { MarkAppInstalledResponse } from '@circles/contracts';

import { invokeFunction, newIdempotencyKey } from '../functions';

/**
 * Tells the server this person has the app (S3-01a): `mark-app-installed`
 * stamps `profiles.app_installed_at` the first time and answers
 * `first_open: true` that once. Safe to call again — every later call is a
 * no-op that says `false` — so a fresh key per call is right: there is nothing
 * a replay needs to be told apart from.
 */
export async function markAppInstalled(): Promise<MarkAppInstalledResponse> {
  return await invokeFunction(
    'mark-app-installed',
    { idempotency_key: newIdempotencyKey() },
    MarkAppInstalledResponse,
  );
}

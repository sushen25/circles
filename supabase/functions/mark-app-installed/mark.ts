import { MarkAppInstalledResponse } from '@circles/contracts';

import { fromInstant, toInstant } from '../_shared/moment.ts';
import { Refusal } from '../_shared/problem.ts';

/** The one database call, as the caller. An interface so the decision is testable without one. */
export interface InstallStore {
  mark(): Promise<{ installed_at: string | null; first_open: boolean } | undefined>;
}

/**
 * The decision, apart from HTTP.
 *
 * A guest is refused before anything is written, as the reason a client can
 * act on; the database would change nothing for one anyway, and say so with a
 * null, which is not an answer a screen can use.
 */
export async function markAppInstalled(
  store: InstallStore,
  isAnonymous: boolean,
): Promise<MarkAppInstalledResponse> {
  if (isAnonymous) {
    throw new Refusal('requires_saved_place', 'Sign in to link this app to your place.');
  }
  const row = await store.mark();
  if (row === undefined || row.installed_at === null) {
    // A permanent identity with no profile row: `handle_new_user` makes one
    // for every user, so this is a database that is not ours to guess about.
    throw new Error('mark_app_installed returned no profile');
  }
  return MarkAppInstalledResponse.parse({
    installed_at: fromInstant(toInstant(row.installed_at)),
    first_open: row.first_open,
  });
}

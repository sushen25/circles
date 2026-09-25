import { MarkAppInstalledRequest } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';
import { markAppInstalled } from './mark.ts';

/**
 * The installed app, opened signed in (S3-01a): the caller's tier becomes
 * `app` (guest-to-app flow §10). The app calls this on every sign-in; the
 * contract says what the answer means, `mark.ts` holds the decision, and
 * `public.mark_app_installed()` the once-only write and its event.
 *
 * As the caller, never the service role: the function stamps `auth.uid()`'s
 * own row, so nothing here could mark anybody else's profile. The log line is
 * the kit's — the function's name and the outcome, nothing about the person.
 */
Deno.serve(
  jsonHandler({
    name: 'mark-app-installed',
    schema: MarkAppInstalledRequest,
    handle: async ({ actor, caller }) =>
      await markAppInstalled(
        {
          async mark() {
            const { data, error } = await caller.rpc('mark_app_installed');
            if (error !== null) throw error;
            return (data as { installed_at: string | null; first_open: boolean }[] | null)?.[0];
          },
        },
        actor.isAnonymous,
      ),
  }),
);

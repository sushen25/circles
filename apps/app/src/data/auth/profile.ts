import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';

import { authClient } from './client';

/**
 * Name and time zone, after a first sign-in (spec §5.1 step 3).
 *
 * **Not an upsert.** `handle_new_user()` already inserted the row when the auth
 * user appeared, defaulting `display_name` to `'Guest'` and `time_zone` to
 * `'UTC'` from whatever sign-up metadata there was — which, on the email path,
 * is nothing. So the row exists and this fills it in.
 *
 * **It writes only what is still a default.** Both fields are editable by the
 * person afterwards (§5.1), and a bootstrap that ran on every sign-in would
 * quietly revert a name they had corrected, or a time zone they had set for a
 * trip, on their next visit. A default is the only safe thing to overwrite.
 */

/** What the trigger writes when it has nothing better. Overwritable; anything else is not. */
const DEFAULT_NAME = 'Guest';
const DEFAULT_ZONE = 'UTC';

export interface ProfileBootstrap {
  /**
   * The name to use if the profile still has none of its own.
   *
   * An argument rather than something read from the session, so that S1-14b can
   * pass `user_metadata.full_name` (first token only) without changing this
   * file, and so that the Your name screen can pass what was typed. The email
   * path has nothing to offer — an address is not a name — and omitting it
   * leaves the row at `Guest` until a screen asks.
   */
  name?: string;
}

/** The device's zone, or `undefined` where the runtime cannot say. */
export function deviceTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone === '' ? undefined : zone;
  } catch {
    return undefined;
  }
}

export async function bootstrapProfile(options: ProfileBootstrap = {}): Promise<void> {
  const client = authClient();
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (userId === undefined) return;

  const { data: profile, error: readError } = await client
    .from('profiles')
    .select('display_name, time_zone')
    .eq('user_id', userId)
    .maybeSingle();
  // A failed read and a missing row arrive the same way — `data: null` — and
  // treating both as "nothing to do" resolves as though the bootstrap
  // succeeded. Connectivity dropping just after the code was verified would
  // then leave the organiser as `Guest` in `UTC`, with nothing to say so.
  if (readError !== null) throw readError;
  if (profile === null || profile === undefined) return;

  const changes: { display_name?: string; time_zone?: string } = {};

  if (profile.display_name === DEFAULT_NAME && options.name !== undefined) {
    const name = normaliseDisplayName(options.name);
    // The domain's rule, not a length check of our own: a name that fails it
    // trips `circle_members_name_length` later, where it is a 500 rather than a
    // question. Silently skipping is right here — this is a bootstrap, and the
    // Your name screen is where a person is told their name will not do.
    if (isValidDisplayName(name)) changes.display_name = name;
  }

  if (profile.time_zone === DEFAULT_ZONE) {
    const zone = deviceTimeZone();
    if (zone !== undefined) changes.time_zone = zone;
  }

  if (Object.keys(changes).length === 0) return;

  const { error } = await client.from('profiles').update(changes).eq('user_id', userId);
  // Thrown rather than swallowed: a profile that did not save leaves somebody
  // called Guest in a circle of their friends, which they will notice and we
  // would not.
  if (error !== null) throw error;
}

/**
 * The name an account goes by, or null when it has not chosen one.
 *
 * `Guest` is the trigger's placeholder, not a name somebody picked — the email
 * path leaves it there until the Your name screen asks — and joining a circle
 * of friends as "Guest" is the thing `bootstrapProfile` exists to prevent. So
 * the placeholder reads as no name, and a screen that needs one asks.
 */
export async function ownDisplayName(): Promise<string | null> {
  const client = authClient();
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (userId === undefined) return null;

  const { data, error } = await client
    .from('profiles')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (error !== null) throw error;
  const name = data?.display_name;
  return name === undefined || name === DEFAULT_NAME ? null : name;
}

/**
 * What the Your name screen starts from: the name this account has chosen, or
 * null while it still carries the placeholder, and the zone it has.
 *
 * `zone` is null while the profile still carries the trigger's defaults, for
 * the same reason the name is: a default nobody chose is not an answer, and the
 * screen should offer the device's zone rather than confirm a placeholder
 * (`profileView`).
 */
export interface OwnProfile {
  name: string | null;
  zone: string | null;
}

export async function ownProfile(): Promise<OwnProfile | null> {
  const client = authClient();
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (userId === undefined) return null;

  const { data, error } = await client
    .from('profiles')
    .select('display_name, time_zone')
    .eq('user_id', userId)
    .maybeSingle();
  if (error !== null) throw new Error('profile lookup failed');
  if (data === null) return null;
  return profileView(data);
}

/**
 * The row as the screens should read it.
 *
 * **`UTC` is only a placeholder while the name is one too.** The trigger
 * writes `Guest` and `UTC` together, and Your name saves both together, so a
 * profile with a name of its own has a zone somebody chose — and `UTC` is a
 * zone a person can be in. Reading every `UTC` as unset (round 1 did) handed
 * such a person the device's zone for their circle instead (review round 2).
 */
export function profileView(row: { display_name: string; time_zone: string }): OwnProfile {
  const named = row.display_name !== DEFAULT_NAME;
  return {
    name: named ? row.display_name : null,
    zone: !named && row.time_zone === DEFAULT_ZONE ? null : row.time_zone,
  };
}

/**
 * The Your name screen's answer (spec §5.1 step 3): both fields, whatever they
 * were, because this is the person choosing rather than a bootstrap guessing.
 *
 * The name is judged by the domain's rule before it is sent, and a name that
 * fails it is refused here rather than at `circle_members_name_length` later.
 * The zone is checked by `enforce_iana_zone` in the database as well; the
 * screen only ever offers zones this runtime recognises.
 *
 * Throws without the name or the zone in the message: an exception message
 * ends up in a log (non-negotiable 8).
 */
export class ProfileNameError extends Error {
  constructor() {
    super('not a usable display name');
    this.name = 'ProfileNameError';
  }
}

export async function saveProfile(input: { name: string; zone: string }): Promise<void> {
  const name = normaliseDisplayName(input.name);
  if (!isValidDisplayName(name)) throw new ProfileNameError();

  const client = authClient();
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (userId === undefined) throw new Error('no session to save a profile for');

  const { error } = await client
    .from('profiles')
    .update({ display_name: name, time_zone: input.zone })
    .eq('user_id', userId);
  if (error !== null) throw new Error('profile save failed');
}

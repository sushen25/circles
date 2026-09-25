import type { Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { authClient } from './client';
import { markAppInstalled } from './install';

/**
 * Whether this device has the app, which only a permanent identity can have
 * recorded (§10, S3-01a). Native only, once per sign-in — it changes at most
 * once ever, and a query per navigation would be a spinner on every screen.
 *
 * **And the place it is recorded.** A saved place signed in on a native build
 * *is* the app installed, so a profile that does not say so yet is told, here,
 * by `mark-app-installed` — on any auth change that brings a saved place: a
 * sign-in, a guest saving their place, or a session restored from a build that
 * did not ask. The server stamps it once and says which call was first.
 *
 * **The first open belongs to one person.** It is kept with the user id it was
 * for, dropped the moment the identity in hand is somebody else, announced to
 * `onAppFirstOpen` listeners (the root layout counts `app_first_open_linked`
 * there, whichever path got here), and handed once to the sign-in that asks
 * `appTierSettled` whether to show the landing. A call that fails leaves the
 * tier at `saved` and is asked again on the next auth change or launch.
 */
let installed = false;
let firstOpenFor: string | undefined;
let readFor: string | undefined;
let loading: Promise<void> = Promise.resolve();
const firstOpenListeners = new Set<() => void>();

/** How long sign-in waits for the answer before routing without it. */
const SETTLE_MS = 3_000;

export function isAppInstalled(): boolean {
  return installed;
}

/** Reads (and on native, records) the tier for this session. The latest call wins `loading`. */
export function loadAppInstalled(session: Session | null): Promise<void> {
  loading = readAppInstalled(session);
  return loading;
}

async function readAppInstalled(session: Session | null): Promise<void> {
  readFor = session?.user.id;
  if (firstOpenFor !== readFor) firstOpenFor = undefined;

  if (Platform.OS === 'web' || session === null || session.user.is_anonymous === true) {
    installed = false;
    return;
  }

  const { data } = await authClient()
    .from('profiles')
    .select('app_installed_at')
    .eq('user_id', session.user.id)
    .maybeSingle();

  installed = data?.app_installed_at !== null && data?.app_installed_at !== undefined;
  if (installed) return;

  try {
    const marked = await markAppInstalled();
    installed = true;
    if (marked.first_open && readFor === session.user.id) {
      firstOpenFor = session.user.id;
      for (const listener of firstOpenListeners) listener();
    }
  } catch {
    // Offline, or the function is unreachable: still `saved`, asked again later.
  }
}

/** Called once per first open, whichever path stamped it. For the analytics event. */
export function onAppFirstOpen(listener: () => void): () => void {
  firstOpenListeners.add(listener);
  return () => {
    firstOpenListeners.delete(listener);
  };
}

/**
 * Once the tier for the session in hand is known: whether this sign-in was the
 * app's first open for `userId`. True once, then false.
 *
 * Bounded: the sign-in has already succeeded, and a stalled function must not
 * hold somebody on the code screen. Past `SETTLE_MS` the answer is "not the
 * first open", which costs the landing and nothing else — the stamp still
 * lands, and the event is still counted by whoever listens.
 */
export async function appTierSettled(userId: string | undefined): Promise<{ firstOpen: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SETTLE_MS);
  });
  await Promise.race([loading, timeout]);
  clearTimeout(timer);
  const was = userId !== undefined && firstOpenFor === userId;
  if (was) firstOpenFor = undefined;
  return { firstOpen: was };
}

/** Tests only. */
export function resetAppTierForTests(): void {
  installed = false;
  firstOpenFor = undefined;
  readFor = undefined;
  loading = Promise.resolve();
  firstOpenListeners.clear();
}

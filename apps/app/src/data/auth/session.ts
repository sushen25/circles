import type { Session } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { setAccessToken } from '../session';
import { authClient } from './client';
import { resumePendingClaim } from './link';

/**
 * Who is here, as the rest of the app asks it (architecture §10, §11).
 *
 * An external store rather than a React context, for the same reason there is
 * one client: the session is owned by `supabase-js`, which refreshes it on a
 * timer regardless of what React is doing. A context would make the truth
 * depend on where a component sits in the tree, and a guard that reads a stale
 * session sends somebody to the wrong screen.
 */

/**
 * The three tiers of spec §4.4, plus the absence of all of them.
 *
 * - `none`  — nobody, or a browser whose storage was cleared.
 * - `guest` — an anonymous session. Can answer, cannot organise (ADR 0004).
 * - `saved` — a permanent identity. Can organise.
 * - `app`   — a saved place on a device with the app installed.
 *
 * `app` is not a fourth kind of *identity*; it is a saved place that has
 * somewhere to receive a push. It exists here because §5.11's prompts turn on
 * it and nothing else can answer the question.
 */
export type SessionStatus = 'none' | 'guest' | 'saved' | 'app';

export interface SessionState {
  status: SessionStatus;
  userId: string | undefined;
  isAnonymous: boolean;
  /**
   * True until the stored session has been read back.
   *
   * Every guard depends on this. Without it, the first render of a circle route
   * sees `none` and sends a signed-in member to Continue-as — a broken screen
   * caused by reading an answer before it exists. The eight states in the
   * definition of done include loading for exactly this reason.
   */
  isLoading: boolean;
}

const SIGNED_OUT: SessionState = {
  status: 'none',
  userId: undefined,
  isAnonymous: false,
  isLoading: true,
};

let state: SessionState = SIGNED_OUT;
let appInstalled = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function statusOf(session: Session | null): SessionStatus {
  if (session === null) return 'none';
  if (session.user.is_anonymous === true) return 'guest';
  // A browser is never `app`, whatever the profile says: the column records
  // that *a* device has the app, and the prompts that read this are asking
  // about the device in front of the person.
  return Platform.OS !== 'web' && appInstalled ? 'app' : 'saved';
}

/**
 * Finishes a claim that an earlier attempt could not get an answer to.
 *
 * Recording the claim is only half a recovery — something has to *ask* again,
 * and the person it belongs to has no reason to walk the save-your-place flow a
 * second time: as far as they are concerned they are signed in. Left to
 * `savePlace` alone the record would sit there until the token expired, and the
 * membership would be lost for the reason the record existed to prevent.
 *
 * So the moment a permanent session appears — restored from storage on start,
 * or arriving from a sign-in — the claim is retried. Failures are swallowed on
 * purpose: this is a background repair, the record survives to be tried again,
 * and nothing on screen is waiting for it.
 */
function resumeClaimFor(session: Session | null): void {
  if (session === null || session.user.is_anonymous === true) return;
  void resumePendingClaim().catch(() => undefined);
}

function publish(session: Session | null): void {
  const next: SessionState = {
    status: statusOf(session),
    userId: session?.user.id,
    isAnonymous: session?.user.is_anonymous === true,
    isLoading: false,
  };

  // Identity comparison keeps `useSyncExternalStore` from re-rendering on every
  // token refresh, which happens roughly hourly and changes nothing here.
  if (
    state.status === next.status &&
    state.userId === next.userId &&
    state.isAnonymous === next.isAnonymous &&
    state.isLoading === next.isLoading
  ) {
    return;
  }

  state = next;
  emit();
}

/**
 * Whether this device has the app, which only a permanent identity can have
 * recorded. Native only, once per sign-in — it changes at most once ever, and a
 * query per navigation would be a spinner on every screen.
 */
async function loadAppInstalled(session: Session | null): Promise<void> {
  if (Platform.OS === 'web' || session === null || session.user.is_anonymous === true) {
    appInstalled = false;
    return;
  }

  const { data } = await authClient()
    .from('profiles')
    .select('app_installed_at')
    .eq('user_id', session.user.id)
    .maybeSingle();

  appInstalled = data?.app_installed_at !== null && data?.app_installed_at !== undefined;
}

let started = false;

/** Bumped by every auth state change, so a slow lookup knows it has been overtaken. */
let generation = 0;

/**
 * Begins watching the session. Idempotent; called from the root layout.
 *
 * **This is what pays the debt S1-21 recorded.** `src/data/session.ts` holds the
 * access token for the parts of the app that are not React — today only the
 * analytics transport, which reads it on every send. Until something called
 * `setAccessToken`, every event was attributed to nobody, which left
 * `plan_timings.median_seconds_from_open_to_response` — §11.4's gate — with
 * nothing to join a link open to an answer by. `onAuthStateChange` fires on
 * sign-in, on every refresh and on sign-out, so pushing it from here covers all
 * three without anyone remembering to.
 */
export function startSessionTracking(): () => void {
  if (started) return () => undefined;
  started = true;

  let client;
  try {
    client = authClient();
  } catch {
    /**
     * No Supabase configuration. That is the deployed app today — a
     * fixture-driven screen gallery with no backend — and every local run of
     * the Playwright suite, which exports without the variables.
     *
     * Publish "signed out, finished loading" rather than leaving every guard
     * on `wait` for ever, which would hold every screen on its loading state.
     * A missing backend is already shouted about where it can be acted on:
     * `check-client-env.mjs` fails the deploy, and `authClient()` throws for
     * anything that actually tries to call it.
     */
    started = false;
    publish(null);
    return () => undefined;
  }

  generation += 1;
  const initial = generation;
  void client.auth.getSession().then(async ({ data }) => {
    await loadAppInstalled(data.session);
    // Same rule as below: if a state change arrived while this was reading, it
    // knows something newer than the stored session does.
    if (initial !== generation) return;
    setAccessToken(data.session?.access_token);
    publish(data.session);
    resumeClaimFor(data.session);
  });

  const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
    // Synchronously, before any await: the transport may send between the state
    // change and the profile query, and an event attributed to the previous
    // identity is worse than one attributed to nobody.
    setAccessToken(session?.access_token);

    /**
     * Only the newest change gets to publish.
     *
     * `loadAppInstalled` is a database round trip, and sign-out during a
     * sign-in — or one identity replacing another, which is exactly what saving
     * a place does — leaves two of them in flight. Whichever query finishes
     * last would otherwise publish last, so a slow lookup for the identity
     * somebody has *left* can overwrite the identity they are now, and every
     * guard and `useSession` then reports the wrong person.
     */
    generation += 1;
    const mine = generation;

    void loadAppInstalled(session).then(() => {
      if (mine !== generation) return;
      publish(session);
      resumeClaimFor(session);
    });
  });

  return () => {
    subscription.subscription.unsubscribe();
    started = false;
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): SessionState {
  return state;
}

/** Who is here. Re-renders only when the answer changes, not on token refresh. */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The current answer, for code that is not a component (guards, one-off checks). */
export function sessionState(): SessionState {
  return state;
}

/** Signs out and clears the stored session. */
export async function signOut(): Promise<void> {
  await authClient().auth.signOut();
}

/** Resets module state so a test starts from nothing. */
export function resetSessionForTests(): void {
  state = SIGNED_OUT;
  generation = 0;
  appInstalled = false;
  started = false;
  listeners.clear();
}

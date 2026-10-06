import { useCallback, useRef, useSyncExternalStore } from 'react';

import {
  forgetJourneys,
  journeyGeneration,
  readJourney,
  subscribeJourneys,
  writeJourney,
} from '../../data/auth/journey';
import type { CodeStart } from '../identity/SavePlaceByEmail';

/**
 * Where the one-step card on Sent has got to (SUS-162): the card, the code,
 * then one of two ends. It is held outside the components (`data/auth/journey.ts`:
 * in memory, forgotten at sign-out) and keyed by the plan's code, because signing in can change the person's user id (into
 * an account the address already has), which reloads the plan under a new key
 * and makes the membership gate above the route replace its children. What the
 * person typed, the switch, and how far they have got must survive that, and so
 * must the answer of a sign-in still in flight when it happens. The address is
 * personal data and is held here the way `typedAddress` holds it: in memory, never
 * in a URL.
 */
export type OneStepStage =
  | { kind: 'card' }
  | { kind: 'code'; start: CodeStart; planId: string }
  /** The place is saved and this plan's emails are on, for `address`. */
  | { kind: 'done'; address: string }
  /** The place is saved; the emails could not be turned on. */
  | { kind: 'partial'; address: string };

export interface OneStep {
  stage: OneStepStage;
  email: string;
  setEmail: (email: string) => void;
  /** The "Save my place" switch: on by default, and no pre-ticked box anywhere else. */
  save: boolean;
  setSave: (save: boolean) => void;
  toCode: (start: CodeStart, planId: string) => void;
  toDone: (address: string) => void;
  toPartial: (address: string) => void;
  toCard: () => void;
  /** False once somebody has signed out since this began: nothing more is done for them. */
  stillMine: () => boolean;
}

interface Held {
  stage: OneStepStage;
  email: string;
  save: boolean;
}

const journeyKey = (key: string) => `sent-one-step:${key}`;

/** `since`: the generation the caller started in; a write from before a sign-out is dropped. */
function write(key: string, fallback: Held, patch: Partial<Held>, since: number): void {
  writeJourney(
    journeyKey(key),
    { ...(readJourney<Held>(journeyKey(key)) ?? fallback), ...patch },
    since,
  );
}

/** For tests: a new session. */
export function forgetOneSteps(): void {
  forgetJourneys();
}

/**
 * `key` is the plan's code (the gallery adds its state to it). `initial` is
 * where a fresh one starts: only the gallery starts anywhere but the card.
 */
export function useOneStep(key: string, initial: OneStepStage = { kind: 'card' }): OneStep {
  const fresh = useRef<Held>({ stage: initial, email: '', save: true });
  const state = useSyncExternalStore(
    subscribeJourneys,
    () => readJourney<Held>(journeyKey(key)) ?? fresh.current,
    () => fresh.current,
  );
  const since = useRef(journeyGeneration());
  const set = useCallback(
    (patch: Partial<Held>) => write(key, fresh.current, patch, since.current),
    [key],
  );
  return {
    stage: state.stage,
    email: state.email,
    setEmail: useCallback((email) => set({ email }), [set]),
    save: state.save,
    setSave: useCallback((save) => set({ save }), [set]),
    toCode: useCallback((start, planId) => set({ stage: { kind: 'code', start, planId } }), [set]),
    toDone: useCallback((address) => set({ stage: { kind: 'done', address } }), [set]),
    // The card comes back for the emails alone, with the address already in it.
    toPartial: useCallback(
      (address) => set({ stage: { kind: 'partial', address }, email: address }),
      [set],
    ),
    stillMine: useCallback(() => since.current === journeyGeneration(), []),
    toCard: useCallback(() => set({ stage: { kind: 'card' } }), [set]),
  };
}

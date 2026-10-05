import { useEffect, useLayoutEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * One set of numbers for every wait in the app, so a fast wait shows nothing
 * and a long one says so (SUS-155, the canvas page "7 · Loading and busy").
 * Each is "about": the point is the order, not the millisecond.
 */
export const WAIT = {
  /** A busy button or row grows its spinner after this. An instant save never shows one. */
  spinnerAfter: 150,
  /** A loading screen shows its skeleton and sentence after this. A fast load never flashes. */
  skeletonAfter: 300,
  /** Once shown, a spinner or skeleton stays at least this long, so it never strobes. */
  shownAtLeast: 400,
  /** "Still working on it…" */
  slowAfter: 8_000,
  /** "Try again", on a loading screen. */
  retryAfter: 20_000,
} as const;

/**
 * True from `showAfter` ms of `active` until `active` is over and the thing has
 * been visible for `shownAtLeast`. Never true for an `active` shorter than
 * `showAfter`.
 */
export function useDelayedShow(
  active: boolean,
  showAfter: number = WAIT.spinnerAfter,
  shownAtLeast: number = WAIT.shownAtLeast,
): boolean {
  const [shownAt, setShownAt] = useState<number | undefined>(undefined);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (active) {
      if (shown) return undefined;
      const id = setTimeout(() => {
        setShownAt(Date.now());
        setShown(true);
      }, showAfter);
      return () => clearTimeout(id);
    }
    if (!shown) return undefined;
    const left = Math.max(0, shownAtLeast - (Date.now() - (shownAt ?? 0)));
    const id = setTimeout(() => setShown(false), left);
    return () => clearTimeout(id);
  }, [active, shown, shownAt, showAfter, shownAtLeast]);

  return shown;
}

/**
 * How long a wait has run. `slow` at about 8 s ("Still working on it…") and
 * `stuck` at about 20 s (a loading screen offers "Try again"). Both go back to
 * false when `active` ends, so the next wait starts from nothing.
 */
export function useSlow(active: boolean): { slow: boolean; stuck: boolean } {
  const [slow, setSlow] = useState(false);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    const a = setTimeout(() => setSlow(true), WAIT.slowAfter);
    const b = setTimeout(() => setStuck(true), WAIT.retryAfter);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
      setSlow(false);
      setStuck(false);
    };
  }, [active]);

  return { slow: active && slow, stuck: active && stuck };
}

/**
 * The device's reduced-motion setting. Reduced motion changes how a wait moves
 * (the pulse and the spinner hold still), never when it appears.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (live) setReduced(value);
      })
      .catch(() => undefined);
    // react-native-web hands back nothing when the browser has no matchMedia.
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced) as
      { remove: () => void } | undefined;
    return () => {
      live = false;
      subscription?.remove();
    };
  }, []);

  return reduced;
}

/**
 * For a screen with a loading branch: stays true while `loading`, and for the
 * rest of the minimum display if the skeleton had already appeared when the
 * data arrived. The skeleton itself is `Loading`'s, which starts its own
 * 300 ms clock when it mounts, at the same moment this starts its.
 *
 * The hold is worked out in the render that `loading` ends in, so `Loading`
 * is never unmounted and mounted again in between.
 */
export function useLoadingHold(loading: boolean): boolean {
  const [since, setSince] = useState<number | undefined>(undefined);
  const shownAt = since === undefined ? undefined : since + WAIT.skeletonAfter;
  const until = shownAt === undefined ? undefined : shownAt + WAIT.shownAtLeast;
  // A hold is a function of the clock; the timer below renders again when it ends.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const holding =
    !loading && shownAt !== undefined && until !== undefined && now >= shownAt && now < until;

  useLayoutEffect(() => {
    if (loading) {
      // Layout effects run before paint; this only records when the wait began.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (since === undefined) setSince(Date.now());
      return undefined;
    }
    if (shownAt === undefined || until === undefined) return undefined;
    const left = until - Date.now();
    if (Date.now() < shownAt || left <= 0) {
      setSince(undefined);
      return undefined;
    }
    const id = setTimeout(() => setSince(undefined), left);
    return () => clearTimeout(id);
  }, [loading, since, shownAt, until]);

  return loading || holding;
}

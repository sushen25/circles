import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';

import { useReducedMotion } from './wait';

/**
 * How one step of the first run gives way to the next (SUS-247, manifesto §5.5).
 *
 * The step slides 12 px and fades in over 200 ms on a strong ease-out
 * (`cubic-bezier(0.23, 1, 0.32, 1)`: it starts fast, so the screen answers the
 * tap, and settles slowly). The screen it replaces leaves faster, in 140 ms, so
 * the old one is gone before the new one has finished arriving. Back runs the
 * same way the other direction. Reduced motion keeps the fades and drops the
 * slide.
 *
 * Each step is a route, so the screen that is going away cannot be animated by
 * the router: it is told to go (`useLeave`), plays its exit, and then runs the
 * navigation. How the next one arrives is remembered here, between the two.
 */
export const STEP_EASING = [0.23, 1, 0.32, 1] as const;

const SLIDE = 12;
const ENTER_MS = 200;
const LEAVE_MS = 140;

export type StepDirection = 'forward' | 'back';

/**
 * What a screen hands its flow when the person goes on: a way to leave this
 * step before the navigation runs, once the flow has decided it may. A flow
 * that refuses (a name that will not do) simply does not call it, and the step
 * stays where it is.
 */
export type Go = (navigate: () => void) => void;

/** How the next step to mount arrives: set as the last one leaves. */
let arriving: StepDirection = 'forward';

type Leave = (direction: StepDirection, then: () => void) => void;
const LeaveContext = createContext<Leave>((_direction, then) => then());

/** Leaves this step, then runs `then`. Outside a `Step`, `then` runs at once. */
export function useLeave(): Leave {
  return useContext(LeaveContext);
}

export function Step({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [from] = useState<StepDirection>(() => arriving);
  const native = Platform.OS !== 'web';
  const [shown] = useState(() => new Animated.Value(0));
  const [slide] = useState(() => new Animated.Value(from === 'forward' ? SLIDE : -SLIDE));
  const leaving = useRef(false);
  const entered = useRef(false);

  // Begins at nothing, so no frame is drawn at full opacity before the fade starts.
  useEffect(() => {
    if (entered.current) return;
    entered.current = true;
    Animated.parallel([
      Animated.timing(shown, {
        toValue: 1,
        duration: ENTER_MS,
        easing: Easing.bezier(...STEP_EASING),
        useNativeDriver: native,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: reduced ? 0 : ENTER_MS,
        easing: Easing.bezier(...STEP_EASING),
        useNativeDriver: native,
      }),
    ]).start();
  }, [native, reduced, shown, slide]);

  const leave = useCallback<Leave>(
    (direction, then) => {
      if (leaving.current) return;
      leaving.current = true;
      arriving = direction;
      Animated.parallel([
        Animated.timing(shown, {
          toValue: 0,
          duration: LEAVE_MS,
          easing: Easing.bezier(...STEP_EASING),
          useNativeDriver: native,
        }),
        Animated.timing(slide, {
          // The way it came in, the other way out: forward leaves to the left.
          toValue: reduced ? 0 : direction === 'forward' ? -SLIDE : SLIDE,
          duration: LEAVE_MS,
          easing: Easing.bezier(...STEP_EASING),
          useNativeDriver: native,
        }),
      ]).start(() => {
        // A step that failed to go (an error, a refusal) is not left behind.
        leaving.current = false;
        then();
      });
    },
    [native, reduced, shown, slide],
  );

  return (
    <LeaveContext.Provider value={leave}>
      <Animated.View style={[styles.step, { opacity: shown, transform: [{ translateX: slide }] }]}>
        {children}
      </Animated.View>
    </LeaveContext.Provider>
  );
}

const styles = StyleSheet.create({
  // Clipped, so a step sliding in never makes the page scroll sideways.
  step: { flex: 1, overflow: 'hidden' },
});

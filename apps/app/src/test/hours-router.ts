import { useEffect, useSyncExternalStore } from 'react';

/**
 * `expo-router` as the answer editor's tests need it (SUS-209): "A time for each
 * day" is `?step=hours` on the plan link, so a push of that step changes the
 * search params the editor reads, and `back` returns them. Everything else is
 * the test's own `replace` / `push` spies.
 *
 * The real router mounts a second editor for the step and hands the answer
 * across (`hoursStep.ts`); here the one editor stays, which is the same screen
 * to the person looking at it. The handing-across is the live suite's to prove.
 */
type Params = Record<string, string>;
type Spies = {
  replace: (href: unknown) => void;
  push: (href: unknown) => void;
  dismissTo?: (href: unknown) => void;
};

let params: Params = {};
let behind: Params[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Call in `beforeEach`: the next test starts on the first screen. */
export function resetHoursRouter(): void {
  params = {};
  behind = [];
  notify();
}

/** The browser's Back button. */
export function browserBack(): void {
  const previous = behind.pop();
  if (previous === undefined) return;
  params = previous;
  notify();
}

export function hoursRouter(spies: Spies) {
  const router = {
    ...spies,
    dismissTo: spies.dismissTo ?? (() => undefined),
    push: (href: unknown) => {
      const next = (href as { params?: Params }).params;
      if (next?.step === 'hours') {
        behind.push(params);
        params = { ...next };
        notify();
        return;
      }
      spies.push(href);
    },
    back: browserBack,
    canGoBack: () => behind.length > 0,
    setParams: (next: Record<string, string | undefined>) => {
      params = Object.fromEntries(
        Object.entries({ ...params, ...next }).filter(([, value]) => value !== undefined),
      ) as Params;
      notify();
    },
  };
  return {
    useRouter: () => router,
    useLocalSearchParams: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => params,
      ),
    usePathname: () => '/j/plan',
    useIsFocused: () => true,
    useFocusEffect: (effect: () => void) => {
      useEffect(() => {
        effect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
    Redirect: () => null,
  };
}

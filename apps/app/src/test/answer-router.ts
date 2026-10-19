/**
 * `expo-router` as the answer editor's tests need it: a router whose `replace`
 * and `push` are the test's own spies, with no search params and nothing behind
 * it. (Until SUS-236 this also played the browser's history for "A time for each
 * day", which was a step of the plan link's address; it is a part of the first
 * screen now, and the address does not change.)
 */
type Spies = {
  replace: (href: unknown) => void;
  push: (href: unknown) => void;
  dismissTo?: (href: unknown) => void;
};

export function answerRouter(spies: Spies) {
  const router = {
    ...spies,
    dismissTo: spies.dismissTo ?? (() => undefined),
    back: () => undefined,
    canGoBack: () => false,
    setParams: () => undefined,
  };
  return {
    useRouter: () => router,
    useLocalSearchParams: () => ({}),
    usePathname: () => '/j/plan',
    useIsFocused: () => true,
    useFocusEffect: () => undefined,
    Redirect: () => null,
  };
}

/**
 * Whether the `(dev)` routes may be shown (SUS-140).
 *
 * Everything under `app/(dev)` renders fixtures: the gallery, the brand sheet,
 * and the screens of features that are not built yet. A person with a link
 * must never reach one. They are shown when the build is a development build,
 * or when it has no backend, which is the gallery and the smoke export. A
 * production build that has a backend (every deployed environment) redirects
 * them to the front door, and the production environment itself answers
 * not-found, backend or not (SUS-119): nothing on the live host should confirm
 * that a gallery exists.
 *
 * Pure, so a test can say it: the layout reads `__DEV__` and `hasBackend()`
 * and passes them in.
 */
export type DevRoutes = 'shown' | 'redirected' | 'not-found';

export function devRoutes({
  isDev,
  hasBackend,
  appEnv,
}: {
  isDev: boolean;
  hasBackend: boolean;
  /** `EXPO_PUBLIC_APP_ENV` as the build inlined it. */
  appEnv: string | undefined;
}): DevRoutes {
  if (appEnv === 'production') return 'not-found';
  return isDev || !hasBackend ? 'shown' : 'redirected';
}

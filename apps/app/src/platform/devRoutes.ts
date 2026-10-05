/**
 * Whether the `(dev)` routes may be shown (SUS-140).
 *
 * Everything under `app/(dev)` renders fixtures: the gallery, the brand sheet,
 * and the screens of features that are not built yet. A person with a link
 * must never reach one. They are shown when the build is a development build,
 * or when it has no backend, which is the gallery and the smoke export. A
 * production build that has a backend (every deployed environment) redirects
 * them to the front door.
 *
 * Pure, so a test can say it: the layout reads `__DEV__` and `hasBackend()`
 * and passes them in.
 */
export function devRoutesAvailable({
  isDev,
  hasBackend,
}: {
  isDev: boolean;
  hasBackend: boolean;
}): boolean {
  return isDev || !hasBackend;
}

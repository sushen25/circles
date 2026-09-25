import { routeIncomingLink } from '../src/data/links/incoming';

/**
 * Every URL the operating system opens the app with, before the router turns
 * it into state (S3-01a). expo-router calls this for the cold-start URL
 * (`Linking.getInitialURL()`) and for every `url` event while the app runs;
 * the web never reaches it — there, `index.ts` does the same job.
 *
 * Route only — the rule is `routeIncomingLink`'s.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return routeIncomingLink(path);
}

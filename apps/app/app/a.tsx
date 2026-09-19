import { ReentryFlow } from '../src/features/identity/join/ReentryFlow';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * `/a#<token>`: the token is in the fragment and was taken out of the address
 * bar before the router loaded (ADR 0023).
 */
export default function Route() {
  return <ReentryFlow />;
}

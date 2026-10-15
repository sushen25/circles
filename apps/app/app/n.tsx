import { StopLettersFlow } from '../src/features/communication/StopLettersFlow';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * `/n#<token>`: stop the cadence nudge. The token is in the fragment and was
 * taken out of the address bar before the router loaded (ADR 0023).
 */
export default function Route() {
  return <StopLettersFlow family="nudges" />;
}

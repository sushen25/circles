import { NudgeStopFlow } from '../src/features/communication/NudgeStopFlow';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * `/n#<token>`: the token is in the fragment and was taken out of the address
 * bar before the router loaded (ADR 0023).
 */
export default function Route() {
  return <NudgeStopFlow />;
}

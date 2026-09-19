import { EmailPrefsFlow } from '../src/features/communication/EmailPrefsFlow';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * `/e#<token>`: the token is in the fragment and was taken out of the address
 * bar before the router loaded (ADR 0023).
 */
export default function Route() {
  return <EmailPrefsFlow />;
}

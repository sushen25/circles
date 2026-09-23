import { AccountFlow } from '../../src/features/identity/AccountFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  return <AccountFlow />;
}

import { AppLandingFlow } from '../../src/features/growth/AppLandingFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  return <AppLandingFlow />;
}

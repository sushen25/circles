import { WelcomeFlow } from '../src/features/identity/WelcomeFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  return <WelcomeFlow />;
}

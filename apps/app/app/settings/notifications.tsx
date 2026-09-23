import { NotificationSettingsFlow } from '../../src/features/communication/NotificationSettingsFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  return <NotificationSettingsFlow />;
}

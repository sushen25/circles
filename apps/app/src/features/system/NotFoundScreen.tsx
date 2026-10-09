import { Link } from 'expo-router';

import { Body, DisplayL, Screen, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * The page that is not there. The router's own `+not-found` renders it, and so
 * does a screen that must be indistinguishable from it: the founder's
 * analytics, for anybody not on the allowlist (SUS-166). Nothing on it can say
 * the address exists.
 */
export function NotFoundScreen() {
  return (
    <Screen>
      <TopBar />
      <Body>
        <Stack gap={12}>
          <DisplayL>{t('notFound', 'title')}</DisplayL>
          <Link href="/">{t('notFound', 'go_home')}</Link>
        </Stack>
      </Body>
    </Screen>
  );
}

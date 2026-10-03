import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * What a crash lands on (SUS-112; manifesto §7.5, the `error` state).
 *
 * Three things, in this order: that it is not the person's doing and what is
 * safe, a way to try again, and a way out that does not depend on the screen
 * that just failed. The reference is what they read out; it is the one the
 * crash was reported under (`reportClientError`), so the founder can find it.
 *
 * Presentational only. It holds no router, no query client and no session,
 * because it renders when any of them may be what broke.
 */
export type CrashScreenProps = {
  reference: string;
  onTryAgain: () => void;
  onGoHome: () => void;
};

export function CrashScreen({ reference, onTryAgain, onGoHome }: CrashScreenProps) {
  return (
    <Screen>
      <TopBar mark />
      <Body>
        <Stack>
          <DisplayL accessibilityRole="header">{t('crash', 'title')}</DisplayL>
          <BodyText>{t('crash', 'detail')}</BodyText>
        </Stack>
        <Notice kind="warn">{t('crash', 'reference', { reference })}</Notice>
      </Body>
      <Foot>
        <Button label={t('crash', 'try_again')} onPress={onTryAgain} />
        <Tertiary label={t('crash', 'go_home')} onPress={onGoHome} />
      </Foot>
    </Screen>
  );
}

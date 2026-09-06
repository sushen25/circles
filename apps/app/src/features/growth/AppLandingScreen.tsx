import { brand } from '@circles/config';

import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  DisplayXL,
  Foot,
  Notice,
  Screen,
  Small,
  Title,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * AppLanding — scaffolded from `docs/design/AppLanding.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type AppLandingProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function AppLandingScreen({ onNext }: AppLandingProps) {
  return (
    <Screen>
      <Body>
        <DisplayL>{brand.name}</DisplayL>
        <Stack>
          <DisplayXL>{t('appLanding', 'welcome_back_priya')}</DisplayXL>
          <BodyText>{t('appLanding', 'signed_in_as_priya_example_com_your')}</BodyText>
        </Stack>
        <Card>
          <Stack>
            <Title>{t('appLanding', 'sunday_crew')}</Title>
            <Small>{t('appLanding', 'locked_in_thu_17_sep_youre_going')}</Small>
          </Stack>
        </Card>
        <Notice>{t('appLanding', 'links_you_tap_from_the_group_chat')}</Notice>
      </Body>
      <Foot>
        <Button label={t('appLanding', 'open_sunday_crew')} onPress={onNext} />
        <Small>{t('appLanding', 'reminders_come_on_thursday_well_ask_about')}</Small>
      </Foot>
    </Screen>
  );
}

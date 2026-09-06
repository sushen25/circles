import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Foot,
  Label,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * EmailVerified — scaffolded from `docs/design/EmailVerified.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type EmailVerifiedProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function EmailVerifiedScreen({ onNext, onBack }: EmailVerifiedProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('emailVerified', 'sunday_crew')}</Label>
          <DisplayXL>{t('emailVerified', 'youll_hear_about_this_meetup_by_email')}</DisplayXL>
          <BodyText>{t('emailVerified', 'only_this_one_well_send_the_confirmed')}</BodyText>
        </Stack>
        <Card>
          <Stack>
            <Title>{t('emailVerified', 'this_meetups_updates')}</Title>
            <Small>{t('emailVerified', 'on_priya_example_com')}</Small>
          </Stack>
        </Card>
        <Small>{t('emailVerified', 'every_email_has_a_link_to_stop')}</Small>
      </Body>
      <Foot>
        <Button label={t('emailVerified', 'back_to_sunday_crew')} onPress={onNext} />
        <Tertiary label={t('emailVerified', 'save_access_on_every_device')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

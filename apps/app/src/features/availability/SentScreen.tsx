import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Input,
  Label,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Sent — scaffolded from `docs/design/Sent.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type SentProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
};

export function SentScreen({ onNext, onBack, onNotNow }: SentProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('sent', 'sunday_crew')}</Label>
          <DisplayXL>{t('sent', 'thanks_priya_your_times_are_in')}</DisplayXL>
          <BodyText>{t('sent', 'maya_will_pick_a_time_once_replies')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Title>{t('sent', 'get_updates_about_this_meetup_by_email')}</Title>
          </Row>
          <Small>{t('sent', 'well_send_the_confirmed_time_any_important')}</Small>
          <Input placeholder={t('sent', 'you_example_com')} />
          <Button label={t('sent', 'send_verification_email')} onPress={onNext} />
          <Tertiary label={t('sent', 'not_now')} onPress={onNotNow} />
        </Card>
        <Small>{t('sent', 'optional_save_your_access_on_every_device')}</Small>
      </Body>
    </Screen>
  );
}

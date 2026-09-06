import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Foot,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * PushAsk — scaffolded from `docs/design/PushAsk.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type PushAskProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
};

export function PushAskScreen({ onNext, onBack, onNotNow }: PushAskProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayXL>{t('pushAsk', 'want_to_know_when_sunday_crew_has')}</DisplayXL>
          <BodyText>{t('pushAsk', 'wed_send_one_notification_when_options_are')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Small>{t('pushAsk', 'options_ready')}</Small>
          </Row>
          <Row>
            <Small>{t('pushAsk', 'locked_in_changed_or_off')}</Small>
          </Row>
          <Row>
            <Small>{t('pushAsk', 'one_reminder_2_hours_before')}</Small>
          </Row>
          <Row>
            <Small>{t('pushAsk', 'anything_else')}</Small>
            <Small>{t('pushAsk', 'never')}</Small>
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button label={t('pushAsk', 'turn_on_notifications')} onPress={onNext} />
        <Tertiary label={t('pushAsk', 'not_now')} onPress={onNotNow} />
      </Foot>
    </Screen>
  );
}

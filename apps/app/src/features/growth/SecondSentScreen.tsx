import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
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
 * SecondSent — scaffolded from `docs/design/SecondSent.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type SecondSentProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
};

export function SecondSentScreen({ onNext, onBack, onNotNow }: SecondSentProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('secondSent', 'sunday_crew')}</Label>
          <DisplayXL>{t('secondSent', 'thanks_priya_your_times_are_in')}</DisplayXL>
          <BodyText>{t('secondSent', 'thats_the_second_time_round_maya_will')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Title>{t('secondSent', 'doing_this_again_next_month')}</Title>
          </Row>
          <BodyText>{t('secondSent', 'the_app_greys_out_your_clashes_while')}</BodyText>
          <Row>
            <Button label={t('secondSent', 'get_the_app')} onPress={onNext} />
          </Row>
          <Tertiary label={t('secondSent', 'not_now')} onPress={onNotNow} />
        </Card>
        <Small>{t('secondSent', 'prefer_email_turn_on_updates_for_this')}</Small>
      </Body>
    </Screen>
  );
}

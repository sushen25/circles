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
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * SparkWaiting — scaffolded from `docs/design/SparkWaiting.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type SparkWaitingProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function SparkWaitingScreen({ onNext, onBack }: SparkWaitingProps) {
  return (
    <Screen>
      <TopBar
        title={t('sparkWaiting', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <Label>{t('sparkWaiting', 'asked_quietly')}</Label>
          <DisplayXL>{t('sparkWaiting', 'were_checking_whos_keen_for_this_weekend')}</DisplayXL>
          <BodyText>{t('sparkWaiting', 'well_tell_you_if_enough_people_say')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Small>{t('sparkWaiting', 'closes')}</Small>
            <Title>{t('sparkWaiting', 'fri_11_sep_12_pm')}</Title>
          </Row>
          <Divider />
          <Row>
            <Small>{t('sparkWaiting', 'opens_up_when')}</Small>
            <Title>{t('sparkWaiting', '3_of_6_are_keen')}</Title>
          </Row>
        </Card>
        <Small>{t('sparkWaiting', 'changed_your_mind_you_can_withdraw_it')}</Small>
      </Body>
      <Foot>
        <Button
          label={t('sparkWaiting', 'back_to_sunday_crew')}
          variant="secondary"
          onPress={onNext}
        />
        <Tertiary label={t('sparkWaiting', 'withdraw_the_ask')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

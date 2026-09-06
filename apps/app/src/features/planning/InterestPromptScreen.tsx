import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Marks,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * InterestPrompt — scaffolded from `docs/design/InterestPrompt.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type InterestPromptProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function InterestPromptScreen({ fixture, onNext, onBack }: InterestPromptProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('interestPrompt', 'sunday_crew')}</Label>
          <DisplayXL>{t('interestPrompt', 'someone_would_be_up_for_a_catch')}</DisplayXL>
          <BodyText>
            {t('interestPrompt', 'your_answer_stays_private_unless_enough_people')}
          </BodyText>
        </Stack>
        <Row>
          <Marks members={fixture.circle.members} />
          <Small>{t('interestPrompt', 'asked_the_whole_circle')}</Small>
        </Row>
      </Body>
      <Foot>
        <Button label={t('interestPrompt', 'im_keen')} onPress={onNext} />
        <Button label={t('interestPrompt', 'not_this_time')} variant="secondary" onPress={onNext} />
        <Small>{t('interestPrompt', 'closes_friday_midday_if_it_goes_quiet')}</Small>
      </Foot>
    </Screen>
  );
}

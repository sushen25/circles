import { Body, BodyText, Card, DisplayL, Screen, Small, Title, TopBar } from '../../components';
import { Row } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * ChooseMode — scaffolded from `docs/design/ChooseMode.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type ChooseModeProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function ChooseModeScreen({ onBack }: ChooseModeProps) {
  return (
    <Screen>
      <TopBar
        title={t('chooseMode', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <DisplayL>{t('chooseMode', 'how_do_you_want_to_start')}</DisplayL>
        <Card recommended>
          <Row>
            <Title>{t('chooseMode', 'plan_openly')}</Title>
          </Row>
          <BodyText>{t('chooseMode', 'you_set_the_window_everyone_marks_the')}</BodyText>
        </Card>
        <Card>
          <Row>
            <Title>{t('chooseMode', 'see_if_people_are_keen')}</Title>
          </Row>
          <BodyText>{t('chooseMode', 'ask_quietly_first_if_three_people_are')}</BodyText>
        </Card>
        <Small>{t('chooseMode', 'either_way_friends_answer_from_a_link')}</Small>
      </Body>
    </Screen>
  );
}

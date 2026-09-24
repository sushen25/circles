import { Pressable } from 'react-native';

import { Body, BodyText, Card, DisplayL, Screen, Small, Title, TopBar } from '../../components';
import { Row } from '../../components/layout';
import { t } from '../../copy';

/**
 * ChooseMode — `docs/design/ChooseMode.dc.html` (spec §5.3, §5.4): plan openly,
 * or see if people are keen first.
 *
 * **The quiet card is behind `flags.quietAsk`.** The quiet ask is Slice 2's:
 * `create-plan` refuses it with `not_yet` until S2-02, so offering the card
 * now would put somebody in front of a request that cannot succeed. Hidden,
 * not disabled — a greyed option with nothing to say about why is a question
 * the screen cannot answer.
 */
export type ChooseModeProps = {
  circleName?: string | undefined;
  quietAsk: boolean;
  onPlanOpenly?: (() => void) | undefined;
  onSeeIfKeen?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function Choice({
  title,
  body,
  recommended = false,
  onPress,
}: {
  title: string;
  body: string;
  recommended?: boolean;
  onPress?: (() => void) | undefined;
}) {
  return (
    <Pressable role="button" aria-label={`${title}. ${body}`} onPress={onPress}>
      <Card recommended={recommended}>
        <Row>
          <Title>{title}</Title>
        </Row>
        <BodyText>{body}</BodyText>
      </Card>
    </Pressable>
  );
}

export function ChooseModeScreen({
  circleName = t('chooseMode', 'sunday_crew'),
  quietAsk,
  onPlanOpenly,
  onSeeIfKeen,
  onBack,
}: ChooseModeProps) {
  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{t('chooseMode', 'how_do_you_want_to_start')}</DisplayL>
        <Choice
          recommended
          title={t('chooseMode', 'plan_openly')}
          body={t('chooseMode', 'you_set_the_window_everyone_marks_the')}
          onPress={onPlanOpenly}
        />
        {quietAsk ? (
          <Choice
            title={t('chooseMode', 'see_if_people_are_keen')}
            body={t('chooseMode', 'ask_quietly_first_if_three_people_are')}
            onPress={onSeeIfKeen}
          />
        ) : null}
        <Small>{t('chooseMode', 'either_way_friends_answer_from_a_link')}</Small>
      </Body>
    </Screen>
  );
}

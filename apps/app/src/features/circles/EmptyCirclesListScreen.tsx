import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Label,
  Screen,
  Small,
  Title,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * EmptyCirclesList — scaffolded from `docs/design/EmptyCirclesList.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type EmptyCirclesListProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function EmptyCirclesListScreen({ onNext, onBack }: EmptyCirclesListProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('emptyCirclesList', 'your_circles')}</DisplayL>
          <BodyText>{t('emptyCirclesList', 'a_circle_is_one_group_of_friends')}</BodyText>
        </Stack>
        <Card>
          <Label>{t('emptyCirclesList', 'how_it_goes')}</Label>
          <Stack>
            <Title>{t('emptyCirclesList', 'name_the_circle')}</Title>
            <Small>{t('emptyCirclesList', 'and_share_one_link_into_the_group')}</Small>
          </Stack>
          <Stack>
            <Title>{t('emptyCirclesList', 'plan_a_catch_up')}</Title>
            <Small>{t('emptyCirclesList', 'friends_answer_from_the_link_no_app')}</Small>
          </Stack>
          <Stack>
            <Title>{t('emptyCirclesList', 'lock_in_the_best_time')}</Title>
            <Small>{t('emptyCirclesList', 'we_give_you_the_message_to_paste')}</Small>
          </Stack>
        </Card>
      </Body>
      <Foot>
        <Button label={t('emptyCirclesList', 'create_your_first_circle')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

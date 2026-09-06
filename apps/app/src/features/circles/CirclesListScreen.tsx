import { Body, Button, Card, DisplayL, Foot, Screen, Small, Title, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * CirclesList — scaffolded from `docs/design/CirclesList.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CirclesListProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function CirclesListScreen({ onNext, onBack }: CirclesListProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{t('circlesList', 'your_circles')}</DisplayL>
        <Card>
          <Stack>
            <Title>{t('circlesList', 'sunday_crew')}</Title>
            <Small>{t('circlesList', 'finding_a_time_5_of_6_replied')}</Small>
          </Stack>
        </Card>
        <Card>
          <Stack>
            <Title>{t('circlesList', 'uni_mates')}</Title>
            <Small>{t('circlesList', 'last_caught_up_2_aug_no_rush')}</Small>
          </Stack>
        </Card>
        <Card>
          <Stack>
            <Title>{t('circlesList', 'book_club')}</Title>
            <Small>{t('circlesList', 'locked_in_thu_24_sep')}</Small>
          </Stack>
        </Card>
      </Body>
      <Foot>
        <Button label={t('circlesList', 'new_circle')} variant="secondary" onPress={onNext} />
      </Foot>
    </Screen>
  );
}

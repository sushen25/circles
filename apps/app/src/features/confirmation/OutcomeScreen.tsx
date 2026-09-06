import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Foot,
  Input,
  Label,
  Screen,
  Title,
  TopBar,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Outcome — scaffolded from `docs/design/Outcome.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type OutcomeProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function OutcomeScreen({ onNext, onBack }: OutcomeProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('outcome', 'sunday_crew_thu_17_sep')}</Label>
          <DisplayXL>{t('outcome', 'did_thursdays_catch_up_happen')}</DisplayXL>
          <BodyText>{t('outcome', 'it_just_sets_when_the_circle_last')}</BodyText>
        </Stack>
        <Card>
          <Stack>
            <Title>{t('outcome', 'it_happened')}</Title>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('outcome', 'it_was_cancelled')}</Title>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('outcome', 'we_moved_it_outside_brand')}</Title>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('outcome', 'not_sure')}</Title>
          </Stack>
        </Card>
        <Stack>
          <Label>{t('outcome', 'a_line_for_the_circles_record_optional')}</Label>
          <Input placeholder={t('outcome', 'great_night_hope_st_again_next_time')} />
        </Stack>
      </Body>
      <Foot>
        <Button label={t('outcome', 'save')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

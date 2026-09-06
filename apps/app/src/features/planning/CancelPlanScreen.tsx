import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Input,
  Label,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * CancelPlan — scaffolded from `docs/design/CancelPlan.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CancelPlanProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function CancelPlanScreen({ onNext, onBack }: CancelPlanProps) {
  return (
    <Screen>
      <TopBar title={t('cancelPlan', 'back')} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('cancelPlan', 'cancel_thursdays_catch_up')}</DisplayL>
          <BodyText>{t('cancelPlan', 'everyone_will_see_its_off_the_circles')}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('cancelPlan', 'a_short_note_optional')}</Label>
          <Input placeholder={t('cancelPlan', 'work_thing_came_up_sorry_all_will')} />
        </Stack>
        <Small>{t('cancelPlan', 'well_give_you_a_message_to_paste')}</Small>
      </Body>
      <Foot>
        <Button label={t('cancelPlan', 'cancel_the_catch_up')} onPress={onNext} />
        <Tertiary label={t('cancelPlan', 'keep_it')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

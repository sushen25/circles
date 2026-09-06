import {
  Body,
  BodyText,
  Button,
  Chip,
  Chips,
  DisplayL,
  Foot,
  Input,
  Label,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * FirstCircle — scaffolded from `docs/design/FirstCircle.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type FirstCircleProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function FirstCircleScreen({ onNext, onBack }: FirstCircleProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('firstCircle', 'step_1_of_2')}</Label>
          <DisplayL>{t('firstCircle', 'who_do_you_keep_meaning_to_see')}</DisplayL>
          <BodyText>{t('firstCircle', 'a_circle_is_one_group_of_friends')}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('firstCircle', 'circle_name')}</Label>
          <Input placeholder={t('firstCircle', 'sunday_crew')} />
        </Stack>
        <Stack>
          <Label>{t('firstCircle', 'how_often_would_you_like_to_catch')}</Label>
          <Chips>
            <Chip label={t('firstCircle', 'weekly')} selected={false} onPress={onNext} />
            <Chip label={t('firstCircle', 'fortnightly')} selected={false} onPress={onNext} />
            <Chip label={t('firstCircle', 'monthly')} selected={true} onPress={onNext} />
            <Chip label={t('firstCircle', 'every_two_months')} selected={false} onPress={onNext} />
            <Chip label={t('firstCircle', 'no_goal')} selected={false} onPress={onNext} />
          </Chips>
          <Small>{t('firstCircle', 'a_loose_aim_not_a_rule_nobody')}</Small>
        </Stack>
      </Body>
      <Foot>
        <Button label={t('firstCircle', 'create_sunday_crew')} onPress={onNext} />
        <Small>{t('firstCircle', 'you_can_change_anything_later')}</Small>
      </Foot>
    </Screen>
  );
}

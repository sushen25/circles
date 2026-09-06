import {
  Body,
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
 * CreateCircle — scaffolded from `docs/design/CreateCircle.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CreateCircleProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CreateCircleScreen({ onNext, onBack }: CreateCircleProps) {
  return (
    <Screen>
      <TopBar
        title={t('createCircle', 'new_circle')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <DisplayL>{t('createCircle', 'whos_this_for')}</DisplayL>
        <Stack>
          <Label>{t('createCircle', 'circle_name')}</Label>
          <Input placeholder={t('createCircle', 'sunday_crew')} />
        </Stack>
        <Stack>
          <Label>{t('createCircle', 'colour')}</Label>
        </Stack>
        <Stack>
          <Label>{t('createCircle', 'how_often_would_you_like_to_catch')}</Label>
          <Chips>
            <Chip label={t('createCircle', 'weekly')} selected={false} onPress={onNext} />
            <Chip label={t('createCircle', 'fortnightly')} selected={false} onPress={onNext} />
            <Chip label={t('createCircle', 'monthly')} selected={true} onPress={onNext} />
            <Chip label={t('createCircle', 'every_two_months')} selected={false} onPress={onNext} />
            <Chip label={t('createCircle', 'no_goal')} selected={false} onPress={onNext} />
          </Chips>
          <Small>{t('createCircle', 'a_loose_aim_not_a_rule_well')}</Small>
        </Stack>
        <Stack>
          <Label>{t('createCircle', 'where_roughly')}</Label>
          <Input placeholder={t('createCircle', 'inner_north_optional')} />
        </Stack>
      </Body>
      <Foot>
        <Button label={t('createCircle', 'create_circle')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Input,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Name — scaffolded from `docs/design/Name.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type NameProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function NameScreen({ onNext, onBack }: NameProps) {
  return (
    <Screen>
      <TopBar title={t('name', 'sunday_crew')} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('name', 'what_should_the_group_call_you')}</DisplayL>
          <BodyText>{t('name', 'just_a_first_name_is_fine_no')}</BodyText>
        </Stack>
        <Input placeholder={t('name', 'priya')} />
        <Small>{t('name', 'this_is_what_maya_and_the_others')}</Small>
      </Body>
      <Foot>
        <Button label={t('name', 'continue')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

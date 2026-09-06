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
 * SaveAccess — scaffolded from `docs/design/SaveAccess.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type SaveAccessProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function SaveAccessScreen({ onNext, onBack }: SaveAccessProps) {
  return (
    <Screen>
      <TopBar
        title={t('saveAccess', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('saveAccess', 'keep_your_place_on_every_device')}</DisplayL>
          <BodyText>{t('saveAccess', 'sign_in_with_your_email_and_youll')}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('saveAccess', 'your_email')}</Label>
          <Input placeholder={t('saveAccess', 'priya_example_com')} />
        </Stack>
        <Small>{t('saveAccess', 'well_send_a_one_time_code_this')}</Small>
      </Body>
      <Foot>
        <Button label={t('saveAccess', 'send_me_a_code')} onPress={onNext} />
        <Tertiary label={t('saveAccess', 'not_now')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

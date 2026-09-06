import { brand } from '@circles/config';

import {
  Body,
  BodyText,
  Button,
  DisplayL,
  DisplayXL,
  Foot,
  Input,
  Label,
  Screen,
  Small,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * SignIn — scaffolded from `docs/design/SignIn.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type SignInProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function SignInScreen({ onNext }: SignInProps) {
  return (
    <Screen>
      <Body>
        <DisplayL>{brand.name}</DisplayL>
        <Stack>
          <DisplayXL>{t('signIn', 'make_room_for_each_other')}</DisplayXL>
          <BodyText>{t('signIn', 'find_a_time_your_friends_are_actually')}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('signIn', 'your_email')}</Label>
          <Input placeholder={t('signIn', 'maya_example_com')} />
        </Stack>
        <Small>{t('signIn', 'well_email_a_one_time_code_no')}</Small>
      </Body>
      <Foot>
        <Button label={t('signIn', 'send_me_a_code')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

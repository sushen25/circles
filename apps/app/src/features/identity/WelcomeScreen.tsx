import { brand } from '@circles/config';

import { Body, BodyText, Button, DisplayL, DisplayXL, Screen, Small } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Welcome — scaffolded from `docs/design/Welcome.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type WelcomeProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function WelcomeScreen({ onNext }: WelcomeProps) {
  return (
    <Screen>
      <Body>
        <DisplayL>{brand.name}</DisplayL>
        <Stack>
          <DisplayXL>{t('welcome', 'make_room_for_each_other')}</DisplayXL>
          <BodyText>{t('welcome', 'find_a_time_your_friends_are_actually')}</BodyText>
        </Stack>
        <Stack>
          <Button
            label={t('welcome', 'continue_with_apple')}
            variant="secondary"
            onPress={onNext}
          />
          <Button
            label={t('welcome', 'continue_with_google')}
            variant="secondary"
            onPress={onNext}
          />
          <Button
            label={t('welcome', 'continue_with_email')}
            variant="secondary"
            onPress={onNext}
          />
        </Stack>
        <Small>{t('welcome', 'friends_you_invite_never_need_an_account')}</Small>
      </Body>
    </Screen>
  );
}

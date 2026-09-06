import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
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
 * InitiateGate — scaffolded from `docs/design/InitiateGate.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type InitiateGateProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function InitiateGateScreen({ onNext, onBack }: InitiateGateProps) {
  return (
    <Screen>
      <TopBar
        title={t('initiateGate', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('initiateGate', 'save_your_place_first')}</DisplayL>
          <BodyText>{t('initiateGate', 'planning_a_catch_up_makes_you_the')}</BodyText>
        </Stack>
        <Stack>
          <Button
            label={t('initiateGate', 'continue_with_apple')}
            variant="secondary"
            onPress={onNext}
          />
          <Button
            label={t('initiateGate', 'continue_with_google')}
            variant="secondary"
            onPress={onNext}
          />
          <Button
            label={t('initiateGate', 'continue_with_email')}
            variant="secondary"
            onPress={onNext}
          />
        </Stack>
        <Small>{t('initiateGate', 'this_links_your_existing_place_as_priya')}</Small>
      </Body>
      <Foot>
        <Tertiary label={t('initiateGate', 'not_now')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

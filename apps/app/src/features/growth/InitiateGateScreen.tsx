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
 * InitiateGate — `docs/design/InitiateGate.dc.html` (spec §5.1, ADR 0004).
 *
 * A guest about to organise is asked to save their place first, worded as the
 * practical need it is ("so we can find you again on any device"), with "Not
 * now" always there. `InitiateGateFlow` drives it.
 *
 * **A provider's button appears only when it has somewhere to go**, as on
 * Welcome: Apple and Google are S1-14b (SUS-77), and a button that does
 * nothing on the way to organising is worse than one that is not there.
 *
 * `intent` is what the person was about to do: plan a catch-up (a named plan,
 * a quiet ask, taking the organiser role) or start a circle.
 */
export type InitiateGateIntent = 'plan' | 'circle';

export type InitiateGateProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  intent?: InitiateGateIntent | undefined;
  circleName?: string | undefined;
  /** The name this person has in the circle, for "links your existing place as …". */
  name?: string | undefined;
  onBack?: (() => void) | undefined;
  onContinueWithApple?: (() => void) | undefined;
  onContinueWithEmail?: (() => void) | undefined;
  onContinueWithGoogle?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
};

export function InitiateGateScreen({
  intent = 'plan',
  circleName,
  name,
  onBack,
  onContinueWithApple,
  onContinueWithEmail,
  onContinueWithGoogle,
  onNotNow,
}: InitiateGateProps) {
  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('initiateGate', 'save_your_place_first')}</DisplayL>
          <BodyText>
            {intent === 'circle'
              ? t('initiateGate', 'starting_a_circle_makes_you_its_owner')
              : t('initiateGate', 'planning_a_catch_up_makes_you_the')}
          </BodyText>
        </Stack>
        <Stack>
          {onContinueWithApple === undefined ? null : (
            <Button
              label={t('initiateGate', 'continue_with_apple')}
              variant="secondary"
              onPress={onContinueWithApple}
            />
          )}
          {onContinueWithGoogle === undefined ? null : (
            <Button
              label={t('initiateGate', 'continue_with_google')}
              variant="secondary"
              onPress={onContinueWithGoogle}
            />
          )}
          <Button
            label={t('initiateGate', 'continue_with_email')}
            variant="secondary"
            onPress={onContinueWithEmail}
          />
        </Stack>
        {name === undefined ? null : (
          <Small>{t('initiateGate', 'this_links_your_existing_place_as', { name })}</Small>
        )}
      </Body>
      <Foot>
        <Tertiary label={t('initiateGate', 'not_now')} onPress={onNotNow} />
      </Foot>
    </Screen>
  );
}

import type { StopFamily } from '@circles/contracts';

import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * StopLetters — `docs/design/NudgeStop.dc.html`, `OrganiserStop.dc.html` and
 * `QuietStop.dc.html` (ADR 0067, ADR 0069).
 *
 * The page behind the stop link under an account-holder letter: "Stop these
 * reminders" under a cadence nudge, "Stop emails about plans you organise"
 * under an organiser's letter, "Stop emails about quiet asks" under a quiet
 * ask's. One page, told which family by its path. **It asks for one tap and
 * does nothing before it**: opening the link spends nothing, so a mail gateway
 * or a link scanner that loads the page stops no letters. It says plainly what
 * the tap stops, and that settings turns it back on. The tap can be repeated
 * without harm, and the page never says whose letters or which circle: the
 * link is the whole of its authority and it reveals nothing.
 */
export type StopLettersState =
  'default' | 'stopping' | 'done' | 'expired' | 'no_token' | 'error' | 'offline';

export type StopLettersProps = {
  family: StopFamily;
  state?: StopLettersState | undefined;
  reference?: string | undefined;
  onStop?: (() => void) | undefined;
};

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Screen>
      <TopBar />
      <Body>
        <Stack>
          <DisplayL>{title}</DisplayL>
          <BodyText>{body}</BodyText>
        </Stack>
      </Body>
    </Screen>
  );
}

export function StopLettersScreen({
  family,
  state = 'default',
  reference,
  onStop,
}: StopLettersProps) {
  switch (state) {
    case 'done':
      return (
        <Message
          title={t('stopLetters', `done_${family}`)}
          body={t('stopLetters', `done_body_${family}`)}
        />
      );
    case 'expired':
      return (
        <Message
          title={t('stopLetters', 'link_expired')}
          body={t('stopLetters', 'link_expired_body')}
        />
      );
    case 'no_token':
      return (
        <Message
          title={t('stopLetters', 'open_it_again')}
          body={t('stopLetters', 'open_it_again_body')}
        />
      );
    default:
      break;
  }

  const problem = state === 'error' || state === 'offline';
  return (
    <Screen>
      <TopBar />
      <Body>
        <Stack>
          <DisplayL>{t('stopLetters', `stop_${family}`)}</DisplayL>
          <BodyText>{t('stopLetters', `body_${family}`)}</BodyText>
        </Stack>
        {problem ? (
          <Notice kind="warn">
            {state === 'offline'
              ? t('stopLetters', 'youre_offline')
              : t('stopLetters', 'couldnt_stop')}
          </Notice>
        ) : null}
        {reference === undefined ? null : (
          <Small>{t('stopLetters', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={t('stopLetters', problem ? 'try_again' : `button_${family}`)}
          busyLabel={t('stopLetters', 'stopping')}
          busy={state === 'stopping'}
          onPress={onStop}
        />
      </Foot>
    </Screen>
  );
}

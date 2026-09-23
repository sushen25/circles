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
  Notice,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * SignIn — `docs/design/SignIn.dc.html`: the email half of signing in
 * (spec §5.1 step 2). The code half is `EnterCodeScreen`; `SignInFlow` drives
 * both.
 *
 * `returning` is somebody sent here from a plan link by "I have an account"
 * (ADR 0022): the headline says what they are doing, and the fine print does
 * not tell them friends never need an account, which is not the question.
 * `'settings'` is an organiser who followed an email's footer to notification
 * settings (ADR 00XX); they are told they will land there, not on a plan.
 */
export type SignInProblem = 'not_an_address' | 'couldnt_send' | 'too_many_tries' | 'offline';

export type SignInProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  email?: string | undefined;
  problem?: SignInProblem | undefined;
  busy?: boolean | undefined;
  returning?: boolean | 'settings' | undefined;
  onEmailChange?: ((email: string) => void) | undefined;
  onSendCode?: (() => void) | undefined;
  /** The fixture journey's next step, when there is no backend. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function problemCopy(problem: SignInProblem): string {
  switch (problem) {
    case 'not_an_address':
      return t('signIn', 'not_an_address');
    case 'couldnt_send':
      return t('signIn', 'couldnt_send');
    case 'too_many_tries':
      return t('signIn', 'too_many_tries');
    case 'offline':
      return t('signIn', 'youre_offline');
  }
}

export function SignInScreen({
  email = '',
  problem,
  busy = false,
  returning = false,
  onEmailChange,
  onSendCode,
  onNext,
  onBack,
}: SignInProps) {
  const send = onSendCode ?? onNext;

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{brand.name}</DisplayL>
        <Stack>
          <DisplayXL>
            {returning
              ? t('signIn', 'sign_in_to_your_account')
              : t('signIn', 'make_room_for_each_other')}
          </DisplayXL>
          <BodyText>
            {returning === 'settings'
              ? t('signIn', 'well_bring_you_back_to_settings')
              : returning
                ? t('signIn', 'well_bring_you_back')
                : t('signIn', 'find_a_time_your_friends_are_actually')}
          </BodyText>
        </Stack>
        <Stack>
          <Label>{t('signIn', 'your_email')}</Label>
          <Input
            aria-label={t('signIn', 'your_email')}
            placeholder={t('signIn', 'maya_example_com')}
            value={email}
            onChangeText={onEmailChange}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={busy ? undefined : send}
          />
        </Stack>
        <Small>
          {returning
            ? t('signIn', 'well_email_a_code')
            : t('signIn', 'well_email_a_one_time_code_no')}
        </Small>
        {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
      </Body>
      <Foot>
        <Button
          label={busy ? t('signIn', 'sending') : t('signIn', 'send_me_a_code')}
          onPress={send}
          disabled={busy}
        />
      </Foot>
    </Screen>
  );
}

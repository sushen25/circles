import {
  Body,
  Button,
  DisplayL,
  Foot,
  InlineLink,
  Input,
  Label,
  Notice,
  Screen,
  Small,
  Step,
  TopBar,
  useStepMotion,
  type Go,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { stepOf } from '../circles/FirstCircleScreen';
import type { SignInProblem } from './SignInScreen';

/**
 * WhosAsking — screen 3 of the first run (SUS-247, spec §5.1): the organiser
 * gate, which is a first name and an email, and **Email me a code**. Nothing
 * else: no summary of the plan (the progress line and Back show that nothing is
 * lost), no paragraph about why, no time zone (the device's, editable in
 * Account). The terms line is as it was.
 *
 * The name is the one the group will see. It is saved to the profile when the
 * code is accepted (`SignInFlow`), so "Your name" is not asked again.
 */
export type WhosAskingProps = {
  circleName: string;
  name?: string | undefined;
  email?: string | undefined;
  nameProblem?: boolean | undefined;
  emailProblem?: 'email_needed' | 'not_an_address' | undefined;
  /** A failure that was not the person's doing, and what they read out. */
  problem?: Exclude<SignInProblem, 'not_an_address'> | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onNameChange?: ((name: string) => void) | undefined;
  onEmailChange?: ((email: string) => void) | undefined;
  /** The screen's one decision. */
  onSendCode?: ((go: Go) => void) | undefined;
  onTerms?: (() => void) | undefined;
  onPrivacy?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function problemCopy(problem: NonNullable<WhosAskingProps['problem']>): string {
  switch (problem) {
    case 'couldnt_send':
      return t('signIn', 'couldnt_send');
    case 'too_many_tries':
      return t('signIn', 'too_many_tries');
    case 'offline':
      return t('signIn', 'youre_offline');
  }
}

export function WhosAskingScreen({
  circleName,
  name = '',
  email = '',
  nameProblem = false,
  emailProblem,
  problem,
  reference,
  busy = false,
  onNameChange,
  onEmailChange,
  onSendCode,
  onTerms,
  onPrivacy,
  onBack,
}: WhosAskingProps) {
  const motion = useStepMotion();
  const leave = motion.leave;
  const send = () => onSendCode?.((navigate) => leave('forward', navigate));

  return (
    <Screen>
      <TopBar
        title={circleName}
        step={stepOf(3, 3)}
        onBack={onBack === undefined ? undefined : () => leave('back', onBack)}
        backLabel={t('common', 'back')}
      />
      <Step motion={motion}>
        <Body>
          <DisplayL>{t('firstRun', 'whos_asking')}</DisplayL>
          <Stack gap={8}>
            <Label>{t('firstRun', 'first_name')}</Label>
            <Input
              aria-label={t('firstRun', 'first_name')}
              value={name}
              onChangeText={onNameChange}
              autoComplete="given-name"
              textContentType="givenName"
              autoCapitalize="words"
              maxLength={40}
              autoFocus
              returnKeyType="next"
              aria-invalid={nameProblem}
            />
            {nameProblem ? <Small>{t('firstRun', 'name_needed')}</Small> : null}
          </Stack>
          <Stack gap={8}>
            <Label>{t('firstRun', 'email')}</Label>
            <Input
              aria-label={t('firstRun', 'email')}
              placeholder={t('firstRun', 'email_hint')}
              value={email}
              onChangeText={onEmailChange}
              autoComplete="email"
              textContentType="emailAddress"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={254}
              returnKeyType="send"
              aria-invalid={emailProblem !== undefined}
              onSubmitEditing={busy ? undefined : send}
            />
            {emailProblem === undefined ? null : (
              <Small>
                {emailProblem === 'email_needed'
                  ? t('firstRun', 'email_needed')
                  : t('signIn', 'not_an_address')}
              </Small>
            )}
          </Stack>
          {problem === undefined ? null : (
            <Stack gap={8}>
              <Notice kind="warn">{problemCopy(problem)}</Notice>
              {reference === undefined ? null : (
                <Small selectable>{t('signIn', 'reference', { reference })}</Small>
              )}
            </Stack>
          )}
        </Body>
        <Foot>
          <Button
            label={t('firstRun', 'email_me_a_code')}
            busyLabel={t('firstRun', 'sending')}
            busy={busy}
            onPress={send}
          />
          <Small>
            {t('savePlace', 'by_continuing_you_agree_to_the')}{' '}
            <InlineLink onPress={onTerms}>{t('savePlace', 'terms')}</InlineLink>{' '}
            {t('savePlace', 'and')}{' '}
            <InlineLink onPress={onPrivacy}>{t('savePlace', 'privacy')}</InlineLink>{' '}
            {t('savePlace', 'basics_no_ads_no_selling_data_18')}
          </Small>
        </Foot>
      </Step>
    </Screen>
  );
}

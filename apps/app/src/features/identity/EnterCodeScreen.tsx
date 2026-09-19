import { useEffect, useState } from 'react';

import {
  Body,
  BodyText,
  Button,
  CodeInput,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * EnterCode — `docs/design/EnterCode.dc.html`: the six-digit code from an email.
 *
 * Two flows drive it: the organiser's sign-in (`SignInFlow`, S1-22) and a guest
 * saving their place (`SaveAccessFlow`, S1-30). It is presentational; each flow
 * decides what the code is for.
 *
 * - **Six boxes, one field** (`CodeInput`): typing advances, a paste of the
 *   whole code fills every box, and the device's one-time-code autofill works.
 * - **Resend waits thirty seconds** after a code is sent (`resendAt`), with
 *   the wait on the button, so a person who has not given the email a chance to
 *   arrive does not spend the send budget on a second one.
 * - **Ten minutes** is said up front ("It works for 10 minutes."), and a code
 *   entered after that is told it has expired rather than that it is wrong.
 */
export type EnterCodeProblem =
  | 'wrong_code'
  | 'expired'
  | 'too_many_tries'
  | 'couldnt_save'
  | 'couldnt_sign_in'
  | 'couldnt_send'
  | 'offline';

export type EnterCodeProps = {
  address?: string | undefined;
  code?: string | undefined;
  problem?: EnterCodeProblem | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  newCodeSent?: boolean | undefined;
  /** Epoch milliseconds when another code may be asked for. Absent: now. */
  resendAt?: number | undefined;
  onCodeChange?: ((code: string) => void) | undefined;
  onContinue?: (() => void) | undefined;
  onSendNewCode?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

/** Thirty seconds between codes (S1-22). */
export const RESEND_AFTER_MS = 30_000;

/** A code is good for ten minutes (spec §5.1; `otp_expiry = 600`). */
export const CODE_LIFETIME_MS = 10 * 60_000;

function problemCopy(problem: EnterCodeProblem): string {
  switch (problem) {
    case 'wrong_code':
      return t('enterCode', 'wrong_code');
    case 'expired':
      return t('enterCode', 'expired');
    case 'too_many_tries':
      return t('enterCode', 'too_many_tries');
    case 'couldnt_save':
      return t('enterCode', 'couldnt_save');
    case 'couldnt_sign_in':
      return t('enterCode', 'couldnt_sign_in');
    case 'couldnt_send':
      return t('enterCode', 'couldnt_send');
    case 'offline':
      return t('enterCode', 'youre_offline');
  }
}

/**
 * Whole seconds until `at`, ticking once a second while there are any.
 *
 * The clock is read when the screen mounts and on each tick, never during a
 * render; a resend moves `at`, and the next tick catches up with it.
 */
function useSecondsUntil(at: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const seconds = at === undefined ? 0 : Math.max(0, Math.ceil((at - now) / 1000));
  const ticking = seconds > 0;

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking, at]);

  return Math.min(seconds, Math.ceil(RESEND_AFTER_MS / 1000));
}

export function EnterCodeScreen({
  address,
  code = '',
  problem,
  reference,
  busy = false,
  newCodeSent = false,
  resendAt,
  onCodeChange,
  onContinue,
  onSendNewCode,
  onBack,
}: EnterCodeProps) {
  const wait = useSecondsUntil(resendAt);
  const complete = code.length === 6;
  const resendDisabled = wait > 0 || busy;

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('enterCode', 'enter_the_code_we_emailed')}</DisplayL>
          {address === undefined ? null : (
            <BodyText>{t('enterCode', 'sent_to', { address })}</BodyText>
          )}
        </Stack>
        <CodeInput
          label={t('enterCode', 'code')}
          value={code}
          onChangeText={(text) => onCodeChange?.(text)}
          onSubmitEditing={complete && !busy ? onContinue : undefined}
          autoFocus
        />
        {newCodeSent && problem === undefined ? (
          <Notice>{t('enterCode', 'new_code_sent')}</Notice>
        ) : null}
        {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('enterCode', 'reference', { reference })}</Small>
        )}
        <Small>{t('enterCode', 'didnt_get_it')}</Small>
      </Body>
      <Foot>
        <Button
          label={busy ? t('enterCode', 'checking') : t('enterCode', 'continue')}
          onPress={onContinue}
          disabled={busy || !complete}
        />
        <Tertiary
          label={
            wait > 0
              ? t('enterCode', 'send_another_in', { count: wait })
              : t('enterCode', 'send_a_new_code')
          }
          disabled={resendDisabled}
          aria-disabled={resendDisabled}
          onPress={onSendNewCode}
        />
      </Foot>
    </Screen>
  );
}

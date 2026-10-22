import { Fragment, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

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
  Step,
  Tertiary,
  TopBar,
  useLeave,
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
 * - **Ten minutes** is how long a code lives (`CODE_LIFETIME_MS`): one entered
 *   after that is told it has expired rather than that it is wrong.
 * - **It sends itself on the sixth digit** and has no Continue button, however
 *   the digits got there (SUS-247). The first run gives it a `step`, so it
 *   arrives as a step of that run does; everywhere else it simply appears.
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
  /**
   * The status line under the boxes while the code is being checked or the
   * circle set up: "Checking", then "Setting up Sunday Crew". Absent while the
   * boxes are being typed in.
   */
  status?: string | undefined;
  /** The first run's top bar: the circle's name in the middle, and "3 of 3" with its line. */
  title?: string | undefined;
  step?: ComponentProps<typeof TopBar>['step'];
  /**
   * What goes in the foot when the run failed after the code was accepted and
   * the person has a way on: Try again, Back to the plan, Change the time.
   * Their words and their actions are the flow's.
   */
  foot?: ReactNode;
  /** Said under the boxes instead of the usual notice, where the flow has its own words. */
  notice?: string | undefined;
  /**
   * The six digits, the moment the sixth is in: typed, pasted or filled by the
   * device's one-time-code. **There is no Continue button** (SUS-247): a code
   * is only ever sent for checking, and a button that does it for you is one
   * more thing to find. After a refusal that left the digits in the boxes (the
   * connection dropped), typing the last one again sends it again.
   */
  onContinue?: ((code: string) => void) | undefined;
  onCodeChange?: ((code: string) => void) | undefined;
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
  status,
  title,
  step,
  foot,
  notice,
  onCodeChange,
  onContinue,
  onSendNewCode,
  onBack,
}: EnterCodeProps) {
  const wait = useSecondsUntil(resendAt);
  const leave = useLeave();
  // A code that was refused is of no use to anyone: clear the boxes and put the
  // cursor back in the first, so the next try is typing and not deleting six
  // digits one by one (SUS-204). `problem` is reset when the next try starts,
  // so a second wrong code does this again.
  const dead = problem === 'wrong_code' || problem === 'expired';
  useEffect(() => {
    if (!dead) return;
    onCodeChange?.('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new refusal matters
  }, [dead]);
  const resendDisabled = wait > 0;
  const shown = notice ?? (problem === undefined ? undefined : problemCopy(problem));
  const Move = step === undefined ? Fragment : Step;

  return (
    <Screen>
      <TopBar
        title={title}
        step={step}
        onBack={onBack === undefined ? undefined : () => leave('back', onBack)}
        backLabel={t('common', 'back')}
      />
      <Move>
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
            editable={!busy}
            onChangeText={(text) => {
              onCodeChange?.(text);
              if (text.length === 6 && !busy) onContinue?.(text);
            }}
            autoFocus
            refocusKey={dead}
          />
          <Small accessibilityLiveRegion="polite" aria-live="polite" style={styles.status}>
            {status ?? ' '}
          </Small>
          {newCodeSent && problem === undefined ? (
            <Notice>{t('enterCode', 'new_code_sent')}</Notice>
          ) : null}
          {shown === undefined ? null : <Notice kind="warn">{shown}</Notice>}
          {reference === undefined ? null : (
            <Small selectable>{t('enterCode', 'reference', { reference })}</Small>
          )}
          <View style={styles.resend}>
            <View style={styles.spam}>
              <Small>{t('enterCode', 'not_there')}</Small>
            </View>
            <Tertiary
              label={
                wait > 0
                  ? t('enterCode', 'send_another_in', { count: wait })
                  : t('enterCode', 'send_another')
              }
              disabled={resendDisabled}
              aria-disabled={resendDisabled}
              onPress={busy ? undefined : onSendNewCode}
            />
          </View>
          {problem !== undefined && !dead && foot === undefined && code.length === 6 ? (
            <Button
              label={t('enterCode', 'try_again')}
              variant="secondary"
              onPress={() => onContinue?.(code)}
            />
          ) : null}
        </Body>
        {foot === undefined ? null : <Foot>{foot}</Foot>}
      </Move>
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { minHeight: 20 },
  resend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  spam: { flexShrink: 1 },
});

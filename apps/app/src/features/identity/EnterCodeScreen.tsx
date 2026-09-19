import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Input,
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
 * One field that takes the whole code, pasted or typed, and the device's
 * one-time-code autofill. S1-22 (SUS-38) owns the organiser's sign-in and may
 * give it the artboard's separate boxes and a resend timer; S1-30 needed it to
 * save a place, and built only this much.
 */
export type EnterCodeProblem = 'wrong_code' | 'couldnt_save' | 'offline';

export type EnterCodeProps = {
  address?: string | undefined;
  code?: string | undefined;
  problem?: EnterCodeProblem | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  newCodeSent?: boolean | undefined;
  onCodeChange?: ((code: string) => void) | undefined;
  onContinue?: (() => void) | undefined;
  onSendNewCode?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function problemCopy(problem: EnterCodeProblem): string {
  switch (problem) {
    case 'wrong_code':
      return t('enterCode', 'wrong_code');
    case 'couldnt_save':
      return t('enterCode', 'couldnt_save');
    case 'offline':
      return t('enterCode', 'youre_offline');
  }
}

export function EnterCodeScreen({
  address,
  code = '',
  problem,
  reference,
  busy = false,
  newCodeSent = false,
  onCodeChange,
  onContinue,
  onSendNewCode,
  onBack,
}: EnterCodeProps) {
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
        <Input
          aria-label={t('enterCode', 'code')}
          value={code}
          onChangeText={(text) => onCodeChange?.(text.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          onSubmitEditing={onContinue}
        />
        {newCodeSent && problem === undefined ? (
          <Notice>{t('enterCode', 'new_code_sent')}</Notice>
        ) : null}
        {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('enterCode', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={busy ? t('enterCode', 'checking') : t('enterCode', 'continue')}
          onPress={onContinue}
          disabled={busy || code.length !== 6}
        />
        <Tertiary label={t('enterCode', 'send_a_new_code')} onPress={onSendNewCode} />
      </Foot>
    </Screen>
  );
}

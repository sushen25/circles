import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * CheckEmail — `docs/design/CheckEmail.dc.html` (spec §5.8).
 *
 * It says "check your email" whatever happened, because the server says
 * nothing else: an answer that told a verified address from an unknown one
 * would let somebody learn which friends use the product. The app card on the
 * artboard is Slice 3 (§5.11) and is not here.
 */
export type CheckEmailProblem = 'too_many_tries' | 'offline' | 'couldnt_send';

export type CheckEmailProps = {
  circleName?: string | undefined;
  /** What they typed, from memory; absent after a reload. */
  address?: string | undefined;
  resent?: boolean | undefined;
  resending?: boolean | undefined;
  problem?: CheckEmailProblem | undefined;
  reference?: string | undefined;
  onUseDifferentAddress?: (() => void) | undefined;
  onResend?: (() => void) | undefined;
  onBackToCircle?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function problemCopy(problem: CheckEmailProblem): string {
  switch (problem) {
    case 'too_many_tries':
      return t('checkEmail', 'too_many_tries');
    case 'offline':
      return t('checkEmail', 'youre_offline');
    case 'couldnt_send':
      return t('checkEmail', 'couldnt_send');
  }
}

export function CheckEmailScreen({
  circleName,
  address,
  resent = false,
  resending = false,
  problem,
  reference,
  onUseDifferentAddress,
  onResend,
  onBackToCircle,
  onBack,
}: CheckEmailProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          {circleName === undefined ? null : <Label>{circleName}</Label>}
          <DisplayXL>{t('checkEmail', 'check_your_email')}</DisplayXL>
          <BodyText>
            {address === undefined
              ? t('checkEmail', 'we_sent_you_a_link')
              : t('checkEmail', 'we_sent_a_link_to', { address })}
          </BodyText>
        </Stack>
        <Notice kind="ok">{t('checkEmail', 'your_times_are_already_in_nothing_here')}</Notice>
        {resent && problem === undefined ? <Notice>{t('checkEmail', 'resent')}</Notice> : null}
        {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('checkEmail', 'reference', { reference })}</Small>
        )}
        <Stack>
          <Small>{t('checkEmail', 'wrong_address')}</Small>
          <Tertiary
            label={t('checkEmail', 'use_a_different_one')}
            onPress={onUseDifferentAddress}
          />
          {address === undefined ? null : (
            <Tertiary
              label={resending ? t('checkEmail', 'resending') : t('checkEmail', 'resend_the_link')}
              onPress={resending ? undefined : onResend}
            />
          )}
        </Stack>
      </Body>
      <Foot>
        {circleName === undefined ? null : (
          <Button
            label={t('checkEmail', 'back_to_circle', { circle: circleName })}
            variant="secondary"
            onPress={onBackToCircle}
          />
        )}
      </Foot>
    </Screen>
  );
}

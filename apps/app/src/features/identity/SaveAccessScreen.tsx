import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Input,
  Label,
  LegalLine,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * SaveAccess — `docs/design/SaveAccess.dc.html` (spec §5.1, §5.11).
 *
 * An account, by email code, so the person never has to rejoin from a new
 * device. The artboard offers email only; Apple and Google arrive with S1-14b.
 * Kept visibly separate from meetup email: signing in subscribes nobody to
 * anything.
 */
export type SaveAccessProblem = 'not_an_address' | 'couldnt_send' | 'too_many_tries' | 'offline';

export type SaveAccessProps = {
  state?: 'default' | 'already_saved' | undefined;
  circleName?: string | undefined;
  email?: string | undefined;
  problem?: SaveAccessProblem | undefined;
  /** Under a failure that was not the person's doing (SUS-200). */
  reference?: string | undefined;
  busy?: boolean | undefined;
  onEmailChange?: ((email: string) => void) | undefined;
  onSendCode?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  /** The terms and privacy links in the 18+ line, where an address is asked for. */
  onTerms?: (() => void) | undefined;
  onPrivacy?: (() => void) | undefined;
};

function problemCopy(problem: SaveAccessProblem): string {
  switch (problem) {
    case 'not_an_address':
      return t('saveAccess', 'not_an_address');
    case 'couldnt_send':
      return t('saveAccess', 'couldnt_send');
    case 'too_many_tries':
      return t('saveAccess', 'too_many_tries');
    case 'offline':
      return t('saveAccess', 'youre_offline');
  }
}

export function SaveAccessScreen({
  state = 'default',
  circleName = '',
  email = '',
  problem,
  reference,
  busy = false,
  onEmailChange,
  onSendCode,
  onNotNow,
  onBack,
  onTerms,
  onPrivacy,
}: SaveAccessProps) {
  if (state === 'already_saved') {
    return (
      <Screen>
        <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Stack>
            <DisplayL>{t('saveAccess', 'already_saved')}</DisplayL>
            <BodyText>{t('saveAccess', 'already_saved_body', { circle: circleName })}</BodyText>
          </Stack>
        </Body>
        <Foot>
          <Tertiary label={t('saveAccess', 'back')} onPress={onBack} />
        </Foot>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('saveAccess', 'keep_your_place_on_every_device')}</DisplayL>
          <BodyText>{t('saveAccess', 'sign_in_with_your_email', { circle: circleName })}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('saveAccess', 'your_email')}</Label>
          <Input
            aria-label={t('saveAccess', 'your_email')}
            placeholder={t('saveAccess', 'you_example_com')}
            value={email}
            onChangeText={onEmailChange}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={onSendCode}
          />
        </Stack>
        {/* What making this account means, in the words Sent uses (ADR 0067), then who it is for. */}
        <Stack gap={8}>
          <Small>{t('sent', 'makes_an_account')}</Small>
          <LegalLine onTerms={onTerms} onPrivacy={onPrivacy} />
        </Stack>
        {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
        {problem === undefined || reference === undefined ? null : (
          <Small selectable>{t('saveAccess', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={t('saveAccess', 'email_me_a_code')}
          busyLabel={t('saveAccess', 'sending')}
          busy={busy}
          onPress={onSendCode}
        />
        <Tertiary label={t('saveAccess', 'not_now')} tone="plain" onPress={onNotNow} />
      </Foot>
    </Screen>
  );
}

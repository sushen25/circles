import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Input,
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
  busy?: boolean | undefined;
  onEmailChange?: ((email: string) => void) | undefined;
  onSendCode?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
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
  busy = false,
  onEmailChange,
  onSendCode,
  onNotNow,
  onBack,
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
        <Small>{t('saveAccess', 'well_send_a_one_time_code_this')}</Small>
        {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
      </Body>
      <Foot>
        <Button
          label={busy ? t('saveAccess', 'sending') : t('saveAccess', 'send_me_a_code')}
          onPress={onSendCode}
          disabled={busy}
        />
        <Tertiary label={t('saveAccess', 'not_now')} onPress={onNotNow} />
      </Foot>
    </Screen>
  );
}

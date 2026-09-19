import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Input,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * Sent — `docs/design/Sent.dc.html` (spec §5.1, §5.8).
 *
 * The answer is in; the rest is optional and must read that way. The email card
 * is one tap to dismiss and records nothing when it is, and "save access" is a
 * tertiary under it (§5.11: the only prompt here in Slice 1).
 *
 * Presentational: `SentFlow` owns the plan, the request and the navigation.
 */
export type SentProblem = 'not_an_address' | 'too_many_tries' | 'offline' | 'couldnt_send';

export type SentProps = {
  state?: 'default' | 'loading' | undefined;
  circleName?: string | undefined;
  /** "Thanks, Priya. Your times are in." */
  headline?: string | undefined;
  /** "Maya will pick a time once replies close on Tuesday…" */
  body?: string | undefined;
  /** False once dismissed or sent: the offer is made once. */
  offerEmail?: boolean | undefined;
  email?: string | undefined;
  problem?: SentProblem | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  /** Offered while the session is a guest's; a saved place has nothing to save. */
  offerSaveAccess?: boolean | undefined;
  /** Shown once, after saving access: the address they can sign in with. */
  savedWith?: string | undefined;
  onEmailChange?: ((email: string) => void) | undefined;
  onSendVerification?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
  onSaveAccess?: (() => void) | undefined;
  onChangeAnswer?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function problemCopy(problem: SentProblem): string {
  switch (problem) {
    case 'not_an_address':
      return t('sent', 'not_an_address');
    case 'too_many_tries':
      return t('sent', 'too_many_tries');
    case 'offline':
      return t('sent', 'youre_offline');
    case 'couldnt_send':
      return t('sent', 'couldnt_send');
  }
}

export function SentScreen({
  state = 'default',
  circleName,
  headline,
  body,
  offerEmail = true,
  email = '',
  problem,
  reference,
  busy = false,
  offerSaveAccess = false,
  savedWith,
  onEmailChange,
  onSendVerification,
  onNotNow,
  onSaveAccess,
  onChangeAnswer,
  onBack,
}: SentProps) {
  if (state === 'loading') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('sent', 'finding_it')}</Small>
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          {circleName === undefined ? null : <Label>{circleName}</Label>}
          {headline === undefined ? null : <DisplayXL>{headline}</DisplayXL>}
          {body === undefined ? null : <BodyText>{body}</BodyText>}
        </Stack>
        {savedWith === undefined ? null : (
          <Notice kind="ok">{t('sent', 'place_saved', { address: savedWith })}</Notice>
        )}
        {offerEmail ? (
          <Card>
            <Row>
              <Title>{t('sent', 'get_updates_about_this_meetup_by_email')}</Title>
            </Row>
            <Small>{t('sent', 'well_send_the_confirmed_time_any_important')}</Small>
            <Input
              aria-label={t('sent', 'your_email')}
              placeholder={t('sent', 'you_example_com')}
              value={email}
              onChangeText={onEmailChange}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={onSendVerification}
            />
            {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
            {reference === undefined ? null : (
              <Small>{t('sent', 'reference', { reference })}</Small>
            )}
            <Button
              label={busy ? t('sent', 'sending') : t('sent', 'send_verification_email')}
              onPress={onSendVerification}
              disabled={busy}
            />
            <Tertiary label={t('sent', 'not_now')} onPress={onNotNow} />
          </Card>
        ) : null}
        {offerSaveAccess ? (
          <Stack>
            <Small>{t('sent', 'save_access_note')}</Small>
            <Tertiary label={t('sent', 'save_access')} onPress={onSaveAccess} />
          </Stack>
        ) : null}
        {onChangeAnswer === undefined ? null : (
          <Tertiary label={t('sent', 'see_my_answer')} onPress={onChangeAnswer} />
        )}
      </Body>
    </Screen>
  );
}

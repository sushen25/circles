import { CONSENT } from '@circles/config';
import { View } from 'react-native';

import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  DisplayXL,
  Foot,
  Input,
  Label,
  Notice,
  Screen,
  SettingRow,
  Small,
  Tertiary,
  Title,
  Toggle,
  TopBar,
  Loading,
  useLoadingHold,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * Sent — `docs/design/Sent.dc.html` (spec §5.1, §5.8).
 *
 * The answer is in; the rest is optional and must read that way. One card, one
 * address: the consent sentence, a "Save my place" switch (on by default; on
 * adds a code and an account, off is the verification link) and one primary
 * whose own words are the consent. It is one tap to dismiss and records nothing
 * when it is (§5.11). SUS-162.
 *
 * The sentence in the card is `CONSENT.text`, the words recorded with the
 * subscription, not a string from the copy file (SUS-109). It comes before the
 * button in reading order, and the done line is a live region.
 *
 * Presentational: `SentFlow` owns the plan, the request and the navigation.
 */
export type SentProblem =
  'not_an_address' | 'too_many_tries' | 'offline' | 'couldnt_send' | 'copy_changed';

export type SentProps = {
  state?: 'default' | 'loading' | 'error' | 'offline' | undefined;
  circleName?: string | undefined;
  /** "Thanks, Priya. Your times are in." */
  headline?: string | undefined;
  /** "Maya will pick a time once replies close on Tuesday…" */
  body?: string | undefined;
  /** False once dismissed: Not now is final for this visit. */
  offerEmail?: boolean | undefined;
  email?: string | undefined;
  problem?: SentProblem | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  /**
   * The "Save my place" switch: its position, or absent when there is nothing
   * to save (a saved place already, or the emails-only retry).
   */
  savePlace?: boolean | undefined;
  /** Done: the address the emails and the saved place are now on. */
  kept?: string | undefined;
  /** The place was saved and the emails could not be turned on. */
  emailsFailed?: boolean | undefined;
  onEmailChange?: ((email: string) => void) | undefined;
  onSavePlaceChange?: ((on: boolean) => void) | undefined;
  /** The primary: Email me about this meetup. */
  onSubmit?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
  onChangeAnswer?: (() => void) | undefined;
  /**
   * The organiser's way on, which is their circle: they asked this question
   * and have just answered it, so the screen ends at the plan finding a time
   * rather than at an offer meant for a guest (ADR 0026).
   */
  onSeeCircle?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
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
    case 'copy_changed':
      return t('sent', 'copy_changed');
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
  savePlace,
  kept,
  emailsFailed = false,
  onEmailChange,
  onSavePlaceChange,
  onSubmit,
  onNotNow,
  onChangeAnswer,
  onSeeCircle,
  onRetry,
  onBack,
}: SentProps) {
  const loading = useLoadingHold(state === 'loading');
  if (loading) {
    return (
      <Loading message={t('sent', 'finding_it')} shape="detail" onBack={onBack} onRetry={onRetry} />
    );
  }

  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayL>
            {state === 'offline' ? t('sent', 'youre_offline') : t('sent', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('sent', 'try_again')} onPress={onRetry} />
        </Foot>
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
        {/* Always mounted, so a screen reader hears the line arrive. */}
        <View aria-live="polite" role="status">
          {kept === undefined ? null : (
            <Notice kind="ok">
              {t('sent', 'kept_and_updates_on', { address: kept, circle: circleName ?? '' })}
            </Notice>
          )}
          {emailsFailed ? <Notice kind="warn">{t('sent', 'saved_but_emails_off')}</Notice> : null}
        </View>
        {offerEmail ? (
          <Card>
            <Row>
              <Title>{t('sent', 'hear_when_its_locked_in')}</Title>
            </Row>
            <Input
              aria-label={t('sent', 'your_email')}
              placeholder={t('sent', 'you_example_com')}
              value={email}
              onChangeText={onEmailChange}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={onSubmit}
            />
            {/* What is recorded is what is shown: `CONSENT.text`, never a copy key (ADR 0019). */}
            <Small>{CONSENT.text}</Small>
            {savePlace === undefined ? null : (
              <SettingRow
                title={t('sent', 'save_my_place', { circle: circleName ?? '' })}
                detail={t('sent', savePlace ? 'get_back_from_any_phone' : 'nothing_is_saved')}
              >
                <Toggle
                  value={savePlace}
                  onValueChange={(on) => onSavePlaceChange?.(on)}
                  label={t('sent', 'save_my_place', { circle: circleName ?? '' })}
                />
              </SettingRow>
            )}
            {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
            {reference === undefined ? null : (
              <Small>{t('sent', 'reference', { reference })}</Small>
            )}
            <Button
              label={t('sent', 'email_me_about_this_meetup')}
              busyLabel={t('sent', 'sending')}
              busy={busy}
              onPress={onSubmit}
            />
            <Tertiary label={t('sent', 'not_now')} onPress={onNotNow} />
          </Card>
        ) : null}
        {onChangeAnswer === undefined ? null : (
          <Tertiary label={t('sent', 'see_my_answer')} onPress={onChangeAnswer} />
        )}
      </Body>
      {onSeeCircle === undefined ? null : (
        <Foot>
          <Button label={t('sent', 'see_how_its_looking')} onPress={onSeeCircle} />
        </Foot>
      )}
    </Screen>
  );
}

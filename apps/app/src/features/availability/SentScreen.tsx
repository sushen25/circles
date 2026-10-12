import { View } from 'react-native';

import {
  Body,
  BodyText,
  Button,
  DisplayL,
  DisplayXL,
  Foot,
  Label,
  Notice,
  Screen,
  Tertiary,
  TopBar,
  Loading,
  useLoadingHold,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { FeedbackLink } from '../feedback/FeedbackLink';
import { SentCard, type SentProblem } from './SentCard';

export type { SentProblem };

export type SentOutcome = {
  kind: 'saved_and_on' | 'on' | 'cant_member' | 'cant_saved';
  address: string;
};

const OUTCOME_COPY = {
  saved_and_on: 'kept_and_updates_on',
  on: 'kept_member_updates_on',
  cant_member: 'cant_email_member',
  cant_saved: 'cant_email_saved',
} as const;

/**
 * Sent — `docs/design/Sent.dc.html` (spec §5.1, §5.8).
 *
 * The answer is in; the rest is optional and must read that way. One card, one
 * address: the consent sentence, a "Save my place" switch (on by default; on
 * adds a code and an account, off is the verification link) and one primary
 * whose own words are the consent. A signed-in member with a confirmed address
 * sees that address as text and one button (`SentCard`, SUS-164). It is one tap to dismiss and records nothing
 * when it is (§5.11). SUS-162.
 *
 * The sentence in the card is `CONSENT.text`, the words recorded with the
 * subscription, not a string from the copy file (SUS-109). It comes before the
 * button in reading order, and the done line is a live region.
 *
 * Presentational: `SentFlow` owns the plan, the request and the navigation.
 */
export type SentProps = {
  state?: 'default' | 'loading' | 'error' | 'offline' | undefined;
  circleName?: string | undefined;
  /** "Thanks, Nina. Your times are in." */
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
  /**
   * A signed-in member's confirmed address (SUS-164): the card shows it as text
   * with one button, and has no field and no switch.
   */
  confirmedEmail?: string | undefined;
  /** How it ended, with the address it is about; each reads as one line in the live region. */
  outcome?: SentOutcome | undefined;
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
  confirmedEmail,
  outcome,
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
          {outcome === undefined ? null : (
            <Notice kind={outcome.kind.startsWith('cant') ? 'warn' : 'ok'}>
              {t('sent', OUTCOME_COPY[outcome.kind], {
                address: outcome.address,
                circle: circleName ?? '',
              })}
            </Notice>
          )}
          {emailsFailed ? <Notice kind="warn">{t('sent', 'saved_but_emails_off')}</Notice> : null}
        </View>
        {offerEmail ? (
          <SentCard
            circleName={circleName}
            email={email}
            confirmedEmail={confirmedEmail}
            problem={problem}
            reference={reference}
            busy={busy}
            savePlace={savePlace}
            onEmailChange={onEmailChange}
            onSavePlaceChange={onSavePlaceChange}
            onSubmit={onSubmit}
            onNotNow={onNotNow}
          />
        ) : null}
        {onChangeAnswer === undefined ? null : (
          <Tertiary label={t('sent', 'see_my_answer')} onPress={onChangeAnswer} />
        )}
      </Body>
      <Foot>
        {onSeeCircle === undefined ? null : (
          <Button label={t('sent', 'see_how_its_looking')} onPress={onSeeCircle} />
        )}
        <FeedbackLink screen="sent" />
      </Foot>
    </Screen>
  );
}

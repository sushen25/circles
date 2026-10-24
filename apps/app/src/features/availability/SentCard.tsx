import { consentFor } from '@circles/config';

import {
  Button,
  Card,
  InlineLink,
  Input,
  Notice,
  SettingRow,
  Small,
  Tertiary,
  Title,
  Toggle,
} from '../../components';
import { Row } from '../../components/layout';
import { t } from '../../copy';

export type SentProblem =
  'not_an_address' | 'too_many_tries' | 'offline' | 'couldnt_send' | 'copy_changed';

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

/**
 * The card on Sent (spec §5.1, §5.8): the consent sentence above the one button,
 * whose own words are the consent. Three shapes of the same card:
 *
 * - **anonymous:** an address field and the "Save my place" switch;
 * - **a saved account with no confirmed address:** the field, no switch;
 * - **a signed-in member with a confirmed address** (`confirmedEmail`, SUS-164):
 *   the address as text, no field, no switch, and no "use a different address".
 *   A confirmed sign-in is proof (ADR 0027, 0055), so one tap turns the emails on.
 *
 * The sentence is `consentFor(account).text`, the words recorded with the
 * subscription, not a string from the copy file (ADR 0019, SUS-109). Two states,
 * two sentences: with the switch on, or no switch because the place is already
 * saved, it adds the nudge an account holder gets; with it off it does not.
 */
export function SentCard({
  circleName,
  email = '',
  confirmedEmail,
  problem,
  reference,
  busy = false,
  savePlace,
  onEmailChange,
  onSavePlaceChange,
  onTerms,
  onPrivacy,
  onSubmit,
  onNotNow,
}: {
  circleName?: string | undefined;
  email?: string | undefined;
  confirmedEmail?: string | undefined;
  problem?: SentProblem | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  savePlace?: boolean | undefined;
  onEmailChange?: ((email: string) => void) | undefined;
  onSavePlaceChange?: ((on: boolean) => void) | undefined;
  onTerms?: (() => void) | undefined;
  onPrivacy?: (() => void) | undefined;
  onSubmit?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
}) {
  // Which sentence the card shows, and so which version is recorded (`useEmailOffer`).
  const account = savePlace !== false;
  const consent = consentFor(account);
  const sentence = <Small>{consent.text}</Small>;
  return (
    <Card>
      <Row>
        <Title>{t('sent', 'hear_when_its_locked_in')}</Title>
      </Row>
      {confirmedEmail === undefined ? (
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
      ) : (
        <Small>{t('sent', 'well_email_you_at', { address: confirmedEmail })}</Small>
      )}
      {savePlace === undefined ? null : (
        <SettingRow
          title={t('sent', 'save_my_place', { circle: circleName ?? '' })}
          detail={t('sent', savePlace ? 'gets_you_back_in' : 'your_place_stays_on_this_phone')}
        >
          <Toggle
            value={savePlace}
            onValueChange={(on) => onSavePlaceChange?.(on)}
            // What is recorded is the words shown when the button was tapped, so the
            // switch holds still while the request is out.
            disabled={busy}
            label={t('sent', 'save_my_place', { circle: circleName ?? '' })}
          />
        </SettingRow>
      )}
      {/* The fine print, the last thing before the button. What is recorded is what is
          shown: the words of `consentFor(account)`, never a copy key (ADR 0019, 0048). The
          account sentence, with its nudge, is for someone who has or is making an account;
          with the switch off it is the shorter one, with no 18+ and no links (SUS-250). */}
      {account ? (
        <Small>
          {sentence} {t('sent', 'eighteen_plus')} {t('sent', 'middle_dot')}{' '}
          <InlineLink onPress={onTerms}>{t('sent', 'terms_link')}</InlineLink>{' '}
          {t('sent', 'middle_dot')}{' '}
          <InlineLink onPress={onPrivacy}>{t('sent', 'privacy_link')}</InlineLink>
        </Small>
      ) : (
        sentence
      )}
      {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
      {reference === undefined ? null : <Small>{t('sent', 'reference', { reference })}</Small>}
      <Button
        label={t(
          'sent',
          savePlace === true ? 'email_me_and_save_my_place' : 'email_me_about_this_meetup',
        )}
        busyLabel={t('sent', 'sending')}
        busy={busy}
        onPress={onSubmit}
      />
      <Tertiary label={t('sent', 'not_now')} tone="plain" onPress={onNotNow} />
    </Card>
  );
}

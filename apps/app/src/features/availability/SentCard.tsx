import { CONSENT } from '@circles/config';

import {
  Button,
  Card,
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
 * The sentence is `CONSENT.text`, the words recorded with the subscription, not
 * a string from the copy file (ADR 0019, SUS-109).
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
  onSubmit?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
}) {
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
      {reference === undefined ? null : <Small>{t('sent', 'reference', { reference })}</Small>}
      <Button
        label={t('sent', 'email_me_about_this_meetup')}
        busyLabel={t('sent', 'sending')}
        busy={busy}
        onPress={onSubmit}
      />
      <Tertiary label={t('sent', 'not_now')} onPress={onNotNow} />
    </Card>
  );
}

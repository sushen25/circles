import { Body, BodyText, Button, DisplayXL, Foot, Screen, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * LinkInvalid — every way a link can fail to let somebody in
 * (`docs/design/LinkInvalid.dc.html`).
 *
 * One screen, several reasons, and none of them says more than the person can
 * act on. `inactive` in particular is one message for "no such link", "reset"
 * and "circle gone", because the server gives one answer for all three.
 */
export type LinkInvalidReason =
  /**
   * `invite_inactive`: the one answer for a link that does not work (ADR 0049),
   * in the words of ADR 0091: it is not active, so ask whoever shared it.
   */
  | 'inactive'
  /** A plan link that is cancelled, expired or made up: the same answer. */
  | 'plan_inactive'
  /**
   * A plan that is live but not admitting (ADR 0091): nobody is told about a
   * link they have not seen, only whom to ask. Names the circle when it is known.
   */
  | 'not_admitting'
  /** A circle's own page, with no membership: ask someone in it to add you. */
  | 'not_in_circle'
  /** The invite fragment was lost between steps — a reload mid-join. */
  | 'open_again'
  /** An emailed re-entry link that is spent, unknown or expired. */
  | 'expired'
  /** An emailed re-entry link to a membership that has since saved its place. */
  | 'account'
  /** An emailed re-entry link opened in a browser signed in to a different account. */
  | 'other_account';

export type LinkInvalidProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  reason?: LinkInvalidReason | undefined;
  /** The circle the plan belongs to, for `not_admitting`: "Ask someone in Sunday Crew". */
  circleName?: string | undefined;
  onSignIn?: (() => void) | undefined;
  onSignOut?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onWhatIsBrand?: (() => void) | undefined;
};

const COPY = {
  inactive: ['this_link_isnt_active_any_more', 'ask_for_a_new_plan_link'],
  plan_inactive: ['this_link_isnt_active_any_more', 'ask_for_a_new_plan_link'],
  not_admitting: ['this_plan_isnt_taking_new_answers', 'ask_someone_in_the_circle'],
  not_in_circle: ['youre_not_in_this_circle', 'this_page_is_for_people_in_it'],
  open_again: ['open_the_link_again', 'open_it_from_the_chat'],
  expired: ['this_link_has_expired', 'open_the_plan_from_the_chat'],
  account: ['this_link_is_for_an_account', 'sign_in_with_that_email'],
  other_account: ['signed_in_as_someone_else', 'this_link_is_for_a_guest_place'],
} as const;

export function LinkInvalidScreen({
  reason = 'inactive',
  circleName,
  onSignIn,
  onSignOut,
  onBack,
  onWhatIsBrand,
}: LinkInvalidProps) {
  const [title, body] = COPY[reason];

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayXL>{t('linkInvalid', title)}</DisplayXL>
          <BodyText>
            {reason === 'not_admitting' && circleName !== undefined
              ? t('linkInvalid', 'ask_someone_to_add_you', { circle: circleName })
              : t('linkInvalid', body)}
          </BodyText>
        </Stack>
      </Body>
      <Foot>
        {reason === 'account' ? (
          <Button label={t('linkInvalid', 'sign_in')} onPress={onSignIn} />
        ) : null}
        {reason === 'other_account' ? (
          <Button label={t('linkInvalid', 'sign_out_and_continue')} onPress={onSignOut} />
        ) : null}
        {onWhatIsBrand === undefined ? null : (
          <Button
            label={t('linkInvalid', 'what_is_brand')}
            variant="secondary"
            onPress={onWhatIsBrand}
          />
        )}
      </Foot>
    </Screen>
  );
}

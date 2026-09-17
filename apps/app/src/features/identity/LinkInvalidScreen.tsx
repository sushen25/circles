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
  /** `invite_inactive`: the artboard's own copy. */
  | 'inactive'
  /** A circle or plan page, no membership, no invite in hand to join with. */
  | 'ask_for_invite'
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
  onSignIn?: (() => void) | undefined;
  onSignOut?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onWhatIsBrand?: (() => void) | undefined;
};

const COPY = {
  inactive: ['this_link_isnt_active_any_more', 'the_circles_owner_may_have_reset_it'],
  ask_for_invite: ['you_need_the_invite', 'ask_whoever_shared_it'],
  open_again: ['open_the_link_again', 'open_it_from_the_chat'],
  expired: ['this_link_has_expired', 'open_the_plan_from_the_chat'],
  account: ['this_link_is_for_an_account', 'sign_in_with_that_email'],
  other_account: ['signed_in_as_someone_else', 'this_link_is_for_a_guest_place'],
} as const;

export function LinkInvalidScreen({
  reason = 'inactive',
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
          <BodyText>{t('linkInvalid', body)}</BodyText>
        </Stack>
      </Body>
      <Foot>
        {reason === 'account' ? (
          <Button label={t('linkInvalid', 'sign_in')} onPress={onSignIn} />
        ) : null}
        {reason === 'other_account' ? (
          <Button label={t('linkInvalid', 'sign_out_and_continue')} onPress={onSignOut} />
        ) : null}
        <Button
          label={t('linkInvalid', 'what_is_brand')}
          variant="secondary"
          onPress={onWhatIsBrand}
        />
      </Foot>
    </Screen>
  );
}

import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Marks,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Row } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Main — the Join page (`docs/design/Main.dc.html`, spec §5.1).
 *
 * Everything §5.1 says comes before any prompt: the circle, who shared it, who
 * is in so far, a sentence about privacy and the effort. Nothing here asks
 * anything of the person until they tap "Choose my times".
 *
 * Members are shown as initials, because that is all `invite_preview` gives a
 * visitor who has not joined — a link forwarded beyond the group should not
 * hand a stranger the roster.
 */
export type InviteView = {
  circleName: string;
  /** Null when whoever made the link has since left the circle. */
  inviterName: string | null;
  memberInitials: readonly string[];
};

export type MainProps = {
  /** The gallery's scenario, used when there is no live invite to show. */
  fixture?: Fixture | undefined;
  invite?: InviteView | undefined;
  state?: ScreenState | undefined;
  /** The request reference, on the error state. */
  reference?: string | undefined;
  /** True while the session for "Choose my times" is being made. */
  busy?: boolean | undefined;
  onNext?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onWhatIsBrand?: (() => void) | undefined;
};

function fromFixture(fixture: Fixture | undefined): InviteView | undefined {
  if (fixture === undefined) return undefined;
  const members = fixture.circle.members.filter((m) => m.waiting !== true);
  return {
    circleName: fixture.circle.name,
    inviterName: fixture.circle.members[0]?.name ?? null,
    memberInitials: members.map((m) => m.name.slice(0, 1)),
  };
}

export function MainScreen({
  fixture,
  invite,
  state = 'default',
  reference,
  busy = false,
  onNext,
  onRetry,
  onBack,
  onWhatIsBrand,
}: MainProps) {
  const view = invite ?? fromFixture(fixture);

  // Failures first. The live flow has no invite to show when the preview is the
  // thing that failed, and a check for the view ahead of this one kept that
  // person on "Opening the invite" with no way to retry.
  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayXL>
            {state === 'offline'
              ? t('main', 'youre_offline')
              : t('main', 'couldnt_open_the_invite')}
          </DisplayXL>
          {reference === undefined ? null : (
            <Notice kind="warn">{t('main', 'reference', { reference })}</Notice>
          )}
        </Body>
        <Foot>
          <Button label={t('main', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  if (state === 'loading' || view === undefined) {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('main', 'opening_the_invite')}</Small>
        </Body>
      </Screen>
    );
  }

  const count = view.memberInitials.length;
  const inSoFar =
    count === 1 ? t('main', 'one_person_in_so_far') : t('main', 'people_in_so_far', { count });

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Label>{t('main', 'youre_invited')}</Label>
        <DisplayXL>{t('main', 'circle_is_finding_a_time', { circle: view.circleName })}</DisplayXL>
        <BodyText>
          {view.inviterName === null
            ? t('main', 'someone_shared_this_link')
            : t('main', 'inviter_shared_this_link', { inviter: view.inviterName })}
        </BodyText>
        {count === 0 ? null : (
          <Row>
            <Marks
              members={view.memberInitials.map((initial) => ({ name: initial }))}
              label={inSoFar}
            />
            <Small>{inSoFar}</Small>
          </Row>
        )}
        <Notice>{t('main', 'no_account_or_app_needed_your_friends')}</Notice>
      </Body>
      <Foot>
        <Button label={t('main', 'choose_my_times')} onPress={onNext} disabled={busy} />
        <Tertiary label={t('main', 'what_is_brand')} onPress={onWhatIsBrand} />
      </Foot>
    </Screen>
  );
}

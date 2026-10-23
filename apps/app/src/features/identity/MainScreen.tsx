import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  LegalLine,
  Loading,
  Marks,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
  useLoadingHold,
} from '../../components';
import { Row } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Main — the Join page (`docs/design/Main.dc.html`, spec §5.1).
 *
 * What §5.1 says comes before any prompt: the circle, who is in, and the effort.
 * It names no sharer (SUS-250): since ADR 0091 any member sends the invite, and
 * the link cannot say who did. Nothing here asks anything of the person until
 * they tap "Join {circle}".
 *
 * Members are shown as initials, because that is all `invite_preview` gives a
 * visitor who has not joined — a link forwarded beyond the group should not
 * hand a stranger the roster.
 */
export type InviteView = {
  circleName: string;
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
  onTerms?: (() => void) | undefined;
  onPrivacy?: (() => void) | undefined;
};

function fromFixture(fixture: Fixture | undefined): InviteView | undefined {
  if (fixture === undefined) return undefined;
  const members = fixture.circle.members.filter((m) => m.waiting !== true);
  return {
    circleName: fixture.circle.name,
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
  onTerms,
  onPrivacy,
}: MainProps) {
  const view = invite ?? fromFixture(fixture);
  const loading = useLoadingHold(state === 'loading' || view === undefined);

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

  if (loading || view === undefined) {
    return (
      <Loading
        message={t('main', 'opening_the_invite')}
        shape="detail"
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }

  const count = view.memberInitials.length;
  const inSoFar =
    count === 1 ? t('main', 'one_person_is_in') : t('main', 'people_are_in', { count });

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayXL>{t('main', 'join_circle', { circle: view.circleName })}</DisplayXL>
        <BodyText>
          {t('main', 'circle_plans_its_catch_ups_here', { circle: view.circleName })}
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
      </Body>
      <Foot>
        <Button
          label={t('main', 'join_the_circle', { circle: view.circleName })}
          busy={busy}
          onPress={onNext}
        />
        {onWhatIsBrand === undefined ? null : (
          <Tertiary label={t('main', 'what_is_brand')} onPress={onWhatIsBrand} />
        )}
        <LegalLine onTerms={onTerms} onPrivacy={onPrivacy} />
      </Foot>
    </Screen>
  );
}

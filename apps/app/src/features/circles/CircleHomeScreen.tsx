import type { ReactNode } from 'react';

import {
  Body,
  Button,
  ButtonRow,
  Card,
  CircleHeader,
  DateText,
  Foot,
  Label,
  Marks,
  Notice,
  Screen,
  Small,
  Title,
  TopBar,
  type Member,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { CircleHomeJoiningScreen } from './CircleHomeJoiningScreen';
import { answeredLabel, MARKS_MAX, marksMore } from './lines';
import { MembersLine, SettingsButton } from './parts';

/**
 * CircleHome, finding a time — `docs/design/CircleHome.dc.html` (spec §5.2):
 * the active plan with its reply count and deadline, last caught up, next one,
 * members and the invite link, and one primary action: the plan's own.
 *
 * The locked-in and about-time states are their own screens
 * (`CircleHomeConfirmedScreen`, `CircleHomeDueScreen`); the flow picks which
 * from the domain's `circleHomeState`.
 */
export type CircleHomeProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  color?: string | undefined;
  subtitle?: string | undefined;
  /** The card's label: "Finding a time", or "Started quietly" (spec §5.4). */
  label?: string | undefined;
  planTitle?: string | undefined;
  /** "Replies close Tue 15 Sep, 6 pm". */
  closes?: string | undefined;
  /** "5 of 6 replied". */
  replied?: string | undefined;
  /**
   * Said to a reader whose answer an edit cleared, until they answer the plan
   * as it is now (SUS-130). Absent for everybody else.
   */
  askedAgain?: string | undefined;
  members?: readonly Member[] | undefined;
  /**
   * The marks on the plan card: who the plan asked, the people still to answer
   * dashed (SUS-198). Defaults to `members`, which is right only in fixtures.
   */
  planMembers?: readonly Member[] | undefined;
  /** What a screen reader hears over them; built from `planMembers` when absent. */
  planMarksLabel?: string | undefined;
  memberCount?: string | undefined;
  lastCaughtUp?: string | undefined;
  nextOne?: string | undefined;
  /** Offered to the owner only: the link is theirs to hand out. */
  onInviteLink?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** Which of the plan's two actions leads; from `circleHomePrimary`. */
  primary?: 'see_how_its_looking' | 'add_my_times' | undefined;
  onBack?: (() => void) | undefined;
  onSeeHowItsLooking?: (() => void) | undefined;
  /**
   * The primary while `askedAgain` is said: the line asks for their times, so
   * the button is the way to give them (SUS-130).
   */
  onAddMyTimes?: (() => void) | undefined;
  /** Offered to the organiser while the plan takes answers (SUS-132). */
  onShareLink?: (() => void) | undefined;
  /** What sharing did when it copied rather than opened a sheet. */
  shareOutcome?: string | undefined;
  /** The morning after's card, under the circle's name, when the reader owes it (S1-29). */
  prompt?: ReactNode;
};

export function CircleHomeScreen({
  fixture,
  state = 'default',
  circleName = t('circleHome', 'sunday_crew'),
  color = 'clay',
  subtitle = t('circleHome', '6_members_about_monthly'),
  label = t('circleHome', 'finding_a_time'),
  planTitle = t('circleHome', 'catch_up_in_the_next_14_days'),
  closes = t('circleHome', 'replies_close_tue_6_pm'),
  replied = t('circleHome', '5_of_6_replied'),
  askedAgain,
  members = fixture?.circle.members ?? [],
  planMembers = members,
  planMarksLabel,
  memberCount = t('circleHome', '6_members'),
  lastCaughtUp = t('circleHome', 'sat_8_aug'),
  nextOne = t('circleHome', 'no_rush'),
  onInviteLink,
  onSettings,
  onRetry,
  primary = 'see_how_its_looking',
  onBack,
  onSeeHowItsLooking,
  onAddMyTimes,
  onShareLink,
  shareOutcome,
  prompt,
}: CircleHomeProps) {
  if (state === 'loading' || state === 'error' || state === 'offline') {
    return <CircleHomeJoiningScreen state={state} onRetry={onRetry} onBack={onBack} />;
  }

  return (
    <Screen>
      <TopBar
        onBack={onBack}
        backLabel={t('common', 'back')}
        right={<SettingsButton onPress={onSettings} />}
      />
      <Body>
        <CircleHeader name={circleName} color={color} subtitle={subtitle} />
        {prompt}
        <Card recommended>
          {/* Stacked, not a row: "Replies close …" beside the label does not
              fit on a narrow phone (S1-27). */}
          <Stack>
            <Label>{label}</Label>
            <Small>{closes}</Small>
          </Stack>
          <Title>{planTitle}</Title>
          <Stack>
            <Marks
              members={planMembers}
              max={MARKS_MAX}
              more={marksMore}
              label={planMarksLabel ?? answeredLabel(planMembers)}
            />
            <Small>{replied}</Small>
          </Stack>
          {askedAgain === undefined ? null : <Notice kind="warn">{askedAgain}</Notice>}
          {onShareLink === undefined ? null : (
            <ButtonRow>
              <Button
                label={t('circleHome', 'share_the_link')}
                variant="secondary"
                onPress={onShareLink}
              />
            </ButtonRow>
          )}
          {shareOutcome === undefined ? null : (
            <Small accessibilityLiveRegion="polite">{shareOutcome}</Small>
          )}
        </Card>
        <Card>
          <Row>
            <Stack>
              <Label>{t('circleHome', 'last_caught_up')}</Label>
              <DateText>{lastCaughtUp}</DateText>
            </Stack>
            <Stack>
              <Label>{t('circleHome', 'next_one')}</Label>
              <DateText>{nextOne}</DateText>
            </Stack>
          </Row>
        </Card>
        <MembersLine members={members} memberCount={memberCount} onInviteLink={onInviteLink} />
      </Body>
      {/* The plan's own next step leads (SUS-197): the domain says which
          (`circleHomePrimary`). There is no "Plan a catch-up" here — a second
          plan is refused while this one runs (ADR 0033). */}
      <Foot>
        {primary === 'add_my_times' ? (
          <Button label={t('circleHome', 'add_my_times')} onPress={onAddMyTimes} />
        ) : (
          <Button label={t('circleHome', 'see_how_its_looking')} onPress={onSeeHowItsLooking} />
        )}
      </Foot>
    </Screen>
  );
}

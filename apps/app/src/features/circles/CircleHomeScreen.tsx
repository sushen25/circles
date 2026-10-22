import type { ReactNode } from 'react';

import {
  Body,
  BodyText,
  Button,
  ButtonRow,
  Card,
  CompactButton,
  CircleHeader,
  Foot,
  Marks,
  Notice,
  Screen,
  Small,
  Title,
  TopBar,
  type Member,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { CircleHomeJoiningScreen } from './CircleHomeJoiningScreen';
import { answeredLabel, MARKS_MAX, marksMore } from './lines';
import { CatchUpFacts, MembersLine, SettingsButton } from './parts';

/**
 * CircleHome, finding a time — `docs/design/CircleHome.dc.html` (spec §5.2):
 * the active plan, titled by its state ("Finding a time", "Replies closed"),
 * with its marks and reply count, last caught up and next one once the circle
 * has met, the members, and one primary action: the plan's own.
 *
 * One way into the chat (ADR 0091): while the plan takes answers the card
 * offers **Share the plan**, which also admits new people, and the members row
 * has no Add someone; once replies have closed the card shares nothing and
 * **Add someone** appears with the members.
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
  /** The card's title, its state: "Finding a time", "Replies closed", or "Started quietly" (spec §5.4). */
  label?: string | undefined;
  planTitle?: string | undefined;
  /**
   * The line under the title: "Replies close Tue 15 Sep, 6 pm", and once they
   * have closed, "Time to pick one" or "Maya picks a time next".
   */
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
  /** "Thursday Lot is full (20 people)", said in place of Add someone at the cap. */
  full?: string | undefined;
  /** False until the circle has met: then there is no last caught up or next one. */
  met?: boolean | undefined;
  lastCaughtUp?: string | undefined;
  nextOne?: string | undefined;
  /** Any member's, while no plan takes answers (ADR 0091). */
  onAddSomeone?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** Which of the plan's actions leads; from `circleHomePrimary`. */
  primary?: 'see_how_its_looking' | 'add_my_times' | 'pick_a_time' | undefined;
  onBack?: (() => void) | undefined;
  onSeeHowItsLooking?: (() => void) | undefined;
  /**
   * The primary while `askedAgain` is said: the line asks for their times, so
   * the button is the way to give them (SUS-130).
   */
  onAddMyTimes?: (() => void) | undefined;
  /** The organiser's primary once replies have closed: the options, to decide. */
  onPickATime?: (() => void) | undefined;
  /** Offered to every member while the plan takes answers (SUS-132). */
  onSharePlan?: (() => void) | undefined;
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
  full,
  met = true,
  lastCaughtUp = t('circleHome', 'sat_8_aug'),
  nextOne = t('circleHome', 'no_rush'),
  onAddSomeone,
  onSettings,
  onRetry,
  primary = 'see_how_its_looking',
  onBack,
  onSeeHowItsLooking,
  onAddMyTimes,
  onPickATime,
  onSharePlan,
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
          {/* Stacked, not a row: "Replies close …" beside the title does not
              fit on a narrow phone (S1-27). */}
          <Stack>
            <Title>{label}</Title>
            <Small>{closes}</Small>
          </Stack>
          <BodyText>{planTitle}</BodyText>
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
          {onSharePlan === undefined ? null : (
            <Stack>
              <ButtonRow>
                <CompactButton
                  label={t('circleHome', 'share_the_plan')}
                  icon="share"
                  tone="accent"
                  onPress={onSharePlan}
                />
              </ButtonRow>
              <Small>{t('circleHome', 'share_the_plan_line')}</Small>
            </Stack>
          )}
          {shareOutcome === undefined ? null : (
            <Small accessibilityLiveRegion="polite">{shareOutcome}</Small>
          )}
        </Card>
        {met ? <CatchUpFacts lastCaughtUp={lastCaughtUp} nextOne={nextOne} /> : null}
        <MembersLine members={members} full={full} onAddSomeone={onAddSomeone} />
      </Body>
      {/* The plan's own next step leads (SUS-197): the domain says which
          (`circleHomePrimary`). There is no "Plan a catch-up" here — a second
          plan is refused while this one runs (ADR 0033). */}
      <Foot>
        {primary === 'add_my_times' ? (
          <Button label={t('circleHome', 'add_my_times')} onPress={onAddMyTimes} />
        ) : primary === 'pick_a_time' ? (
          <Button label={t('circleHome', 'pick_a_time')} onPress={onPickATime} />
        ) : (
          <Button label={t('circleHome', 'see_how_its_looking')} onPress={onSeeHowItsLooking} />
        )}
      </Foot>
    </Screen>
  );
}

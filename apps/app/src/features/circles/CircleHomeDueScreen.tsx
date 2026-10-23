import type { ReactNode } from 'react';

import {
  Body,
  BodyText,
  Button,
  ButtonRow,
  Card,
  CircleHeader,
  Foot,
  Notice,
  Screen,
  Title,
  TopBar,
  type Member,
} from '../../components';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { CatchUpFacts, MembersLine, SettingsButton } from './parts';

/**
 * CircleHome, between catch-ups — `docs/design/CircleHomeDue.dc.html` (spec
 * §5.2, §5.9). Two of circle home's states share this layout:
 *
 * - **about time** (`due`): the nudge card, "It's been about a month since …",
 *   which tells the one person the cadence nudge asked that it is their turn.
 *   **Snooze a month** (the owner's) and **Turn off nudges** (the reader's own)
 *   are each drawn only when a handler is given (S2-04).
 * - **no rush / no goal**: the same home with no card — last caught up, next
 *   one, members with **Add someone** (any member's, ADR 0091), and "Plan a
 *   catch-up".
 *
 * Never "overdue", a streak or a count of days (spec §5.9).
 */
export type CircleHomeDueProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  /** False for a circle that is simply between catch-ups: no nudge card. */
  due?: boolean | undefined;
  /**
   * An archived circle: said at the top, and the one action is its settings,
   * where it can be brought back. Nothing is planned in an archived circle
   * (`create_plan` refuses `circle_archived`).
   */
  archived?: boolean | undefined;
  circleName?: string | undefined;
  color?: string | undefined;
  subtitle?: string | undefined;
  body?: string | undefined;
  /** False until the circle has met. A circle between catch-ups always has. */
  met?: boolean | undefined;
  lastCaughtUp?: string | undefined;
  nextOne?: string | undefined;
  members?: readonly Member[] | undefined;
  /** "Thursday Lot is full (20 people)", said in place of Add someone at the cap. */
  full?: string | undefined;
  onAddSomeone?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  /** The screen's one decision: plan the next one. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSnoozeAMonth?: (() => void) | undefined;
  onTurnOffNudges?: (() => void) | undefined;
  /** What Snooze or Turn off just did, or that it did not save. */
  notice?: string | undefined;
  /** The morning after's card, under the circle's name, when the reader owes it (S1-29). */
  prompt?: ReactNode;
};

export function CircleHomeDueScreen({
  fixture,
  due = true,
  archived = false,
  circleName = t('circleHomeDue', 'sunday_crew'),
  color = 'clay',
  subtitle = t('circleHomeDue', '6_members_about_monthly'),
  body = t('circleHomeDue', 'its_been_about_a_month_since_sunday'),
  met = true,
  lastCaughtUp = t('circleHomeDue', 'thu_17_sep'),
  nextOne = t('circleHomeDue', 'nothing_yet'),
  members = fixture?.circle.members ?? [],
  full,
  onAddSomeone,
  onSettings,
  onNext,
  onBack,
  onSnoozeAMonth,
  onTurnOffNudges,
  notice,
  prompt,
}: CircleHomeDueProps) {
  const later = onSnoozeAMonth !== undefined || onTurnOffNudges !== undefined;
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
        {archived ? <Notice>{t('circleHome', 'archived')}</Notice> : null}
        {notice !== undefined && !archived ? <Notice>{notice}</Notice> : null}
        {due && !archived ? (
          <Card>
            <Title>{t('circleHomeDue', 'about_time_for_the_next_one')}</Title>
            <BodyText>{body}</BodyText>
            {later ? (
              <ButtonRow>
                {onSnoozeAMonth === undefined ? null : (
                  <Button
                    label={t('circleHomeDue', 'snooze_a_month')}
                    variant="secondary"
                    onPress={onSnoozeAMonth}
                  />
                )}
                {onTurnOffNudges === undefined ? null : (
                  <Button
                    label={t('circleHomeDue', 'turn_off_nudges')}
                    variant="secondary"
                    onPress={onTurnOffNudges}
                  />
                )}
              </ButtonRow>
            ) : null}
          </Card>
        ) : null}
        {met ? <CatchUpFacts lastCaughtUp={lastCaughtUp} nextOne={nextOne} /> : null}
        <MembersLine
          members={members}
          full={archived ? undefined : full}
          onAddSomeone={archived ? undefined : onAddSomeone}
        />
      </Body>
      <Foot>
        {archived ? (
          <Button label={t('circleHome', 'settings')} variant="secondary" onPress={onSettings} />
        ) : (
          <Button
            label={due ? t('circleHomeDue', 'plan_another') : t('circleHome', 'plan_a_catch_up')}
            onPress={onNext}
          />
        )}
      </Foot>
    </Screen>
  );
}

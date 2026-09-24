import type { ReactNode } from 'react';

import {
  Body,
  BodyText,
  Button,
  ButtonRow,
  Card,
  CircleHeader,
  DateText,
  Foot,
  Label,
  Notice,
  Screen,
  TopBar,
  type Member,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { MembersLine, SettingsButton } from './parts';

/**
 * CircleHome, between catch-ups — `docs/design/CircleHomeDue.dc.html` (spec
 * §5.2, §5.9). Two of circle home's states share this layout:
 *
 * - **about time** (`due`): the nudge card, "It's been about a month since …".
 *   The card is drawn from the circle's own cadence; the cron that decides who
 *   is asked to plan, and Snooze / Turn off, are S2-04's, so those two buttons
 *   appear only when a handler is given.
 * - **no rush / no goal**: the same home with no card — last caught up, next
 *   one, members, and "Plan a catch-up".
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
  lastCaughtUp?: string | undefined;
  nextOne?: string | undefined;
  members?: readonly Member[] | undefined;
  memberCount?: string | undefined;
  onInviteLink?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  /** The screen's one decision: plan the next one. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSnoozeAMonth?: (() => void) | undefined;
  onTurnOffNudges?: (() => void) | undefined;
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
  lastCaughtUp = t('circleHomeDue', 'thu_17_sep'),
  nextOne = t('circleHomeDue', 'nothing_yet'),
  members = fixture?.circle.members ?? [],
  memberCount = t('circleHomeDue', '6_members'),
  onInviteLink,
  onSettings,
  onNext,
  onBack,
  onSnoozeAMonth,
  onTurnOffNudges,
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
        {due && !archived ? (
          <Card>
            <Label>{t('circleHomeDue', 'about_time_for_the_next_one')}</Label>
            <BodyText>{body}</BodyText>
            {later ? (
              <ButtonRow>
                <Button
                  label={t('circleHomeDue', 'snooze_a_month')}
                  variant="secondary"
                  onPress={onSnoozeAMonth}
                />
                <Button
                  label={t('circleHomeDue', 'turn_off_nudges')}
                  variant="secondary"
                  onPress={onTurnOffNudges}
                />
              </ButtonRow>
            ) : null}
          </Card>
        ) : null}
        <Card>
          <Row>
            <Stack>
              <Label>{t('circleHomeDue', 'last_caught_up')}</Label>
              <DateText>{lastCaughtUp}</DateText>
            </Stack>
            <Stack>
              <Label>{t('circleHomeDue', 'next_one')}</Label>
              <DateText>{nextOne}</DateText>
            </Stack>
          </Row>
        </Card>
        <MembersLine
          members={members}
          memberCount={memberCount}
          onInviteLink={archived ? undefined : onInviteLink}
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

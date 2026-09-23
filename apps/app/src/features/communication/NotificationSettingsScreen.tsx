import {
  Body,
  BodyText,
  Button,
  Card,
  CompactButton,
  DisplayL,
  Notice,
  Screen,
  SettingRow,
  Sheet,
  Small,
  Title,
  Toggle,
  TopBar,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * NotificationSettings — `docs/design/NotificationSettings.dc.html` (spec
 * §5.8): for each circle, everything it sends, its quiet asks, and the nudge to
 * plan the next one; then quiet hours, which are fixed at 9 pm–8 am in the
 * reader's own zone for the MVP ("Change" says so rather than pretending).
 *
 * Every circle's switches are the reader's own membership row. Above them,
 * "Emails about plans you organise" is the reader's own profile (ADR 00XX):
 * one switch, because the letters go to their address whichever circle the
 * plan is in. Its detail line says which one still comes, so it does not lie.
 */
export type CircleNotificationRow = {
  circleId: string;
  circleName: string;
  allOn: boolean;
  quietAsksOn: boolean;
  nudgesOn: boolean;
};

export type NotificationSwitch = 'all' | 'quietAsks' | 'nudges';

export type NotificationSettingsProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circles?: readonly CircleNotificationRow[] | undefined;
  problem?: string | undefined;
  quietHoursOpen?: boolean | undefined;
  /** Absent while it is not known; the card is left out rather than guessed. */
  organiserEmailOn?: boolean | undefined;
  /** A save is in flight; the switch holds until it lands. */
  organiserEmailSaving?: boolean | undefined;
  onOrganiserEmail?: ((on: boolean) => void) | undefined;
  onToggle?: ((circleId: string, which: NotificationSwitch, on: boolean) => void) | undefined;
  onQuietHours?: (() => void) | undefined;
  onCloseQuietHours?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function NotificationSettingsScreen({
  state = 'default',
  circles = [],
  problem,
  quietHoursOpen = false,
  organiserEmailOn,
  organiserEmailSaving = false,
  onOrganiserEmail,
  onToggle,
  onQuietHours,
  onCloseQuietHours,
  onRetry,
  onBack,
}: NotificationSettingsProps) {
  const top = (
    <TopBar
      title={t('notificationSettings', 'notifications')}
      onBack={onBack}
      backLabel={t('common', 'back')}
    />
  );

  if (state === 'loading') {
    return (
      <Screen>
        {top}
        <Body>
          <Small accessibilityLiveRegion="polite">{t('notificationSettings', 'loading')}</Small>
        </Body>
      </Screen>
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        {top}
        <Body>
          <DisplayL>
            {state === 'offline'
              ? t('notificationSettings', 'youre_offline')
              : t('notificationSettings', 'couldnt_load')}
          </DisplayL>
          <Button label={t('notificationSettings', 'try_again')} onPress={onRetry} />
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      {top}
      <Body>
        <DisplayL>{t('notificationSettings', 'notifications')}</DisplayL>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        {organiserEmailOn === undefined ? null : (
          <Card>
            <SettingRow
              title={t('notificationSettings', 'emails_about_plans_you_organise')}
              detail={t(
                'notificationSettings',
                'options_ready_and_did_it_happen_replies_closed_still_comes',
              )}
            >
              <Toggle
                value={organiserEmailOn}
                disabled={organiserEmailSaving}
                onValueChange={(on) => onOrganiserEmail?.(on)}
                label={t('notificationSettings', 'emails_about_plans_you_organise')}
              />
            </SettingRow>
          </Card>
        )}
        {circles.length === 0 ? (
          <BodyText>{t('notificationSettings', 'no_circles')}</BodyText>
        ) : null}
        {circles.map((circle) => (
          <Card key={circle.circleId}>
            <SettingRow
              title={circle.circleName}
              detail={t('notificationSettings', 'new_plans_options_ready_locked_in_reminders')}
            >
              <Toggle
                value={circle.allOn}
                onValueChange={(on) => onToggle?.(circle.circleId, 'all', on)}
                label={t('notificationSettings', 'all_in', { circle: circle.circleName })}
              />
            </SettingRow>
            <Divider />
            <SettingRow
              title={t('notificationSettings', 'quiet_asks_in', { circle: circle.circleName })}
              detail={t('notificationSettings', 'someone_wondering_if_people_are_keen')}
            >
              <Toggle
                value={circle.quietAsksOn}
                onValueChange={(on) => onToggle?.(circle.circleId, 'quietAsks', on)}
                label={t('notificationSettings', 'quiet_asks_in', { circle: circle.circleName })}
              />
            </SettingRow>
            <Divider />
            <SettingRow
              title={t('notificationSettings', 'nudges_to_plan_the_next_one')}
              detail={t('notificationSettings', 'only_when_its_your_turn')}
            >
              <Toggle
                value={circle.nudgesOn}
                onValueChange={(on) => onToggle?.(circle.circleId, 'nudges', on)}
                label={t('notificationSettings', 'nudges_in', { circle: circle.circleName })}
              />
            </SettingRow>
          </Card>
        ))}
        <Card>
          <SettingRow
            title={t('notificationSettings', 'quiet_hours')}
            detail={t('notificationSettings', '9_pm_8_am_your_time')}
          >
            <CompactButton label={t('notificationSettings', 'change')} onPress={onQuietHours} />
          </SettingRow>
        </Card>
        <Small>{t('notificationSettings', 'we_only_send_when_the_group_needs')}</Small>
      </Body>
      <Sheet
        visible={quietHoursOpen}
        onDismiss={() => onCloseQuietHours?.()}
        label={t('notificationSettings', 'quiet_hours_title')}
        dismissLabel={t('notificationSettings', 'got_it')}
      >
        <Stack>
          <Title>{t('notificationSettings', 'quiet_hours_title')}</Title>
          <BodyText>{t('notificationSettings', 'quiet_hours_body')}</BodyText>
        </Stack>
        <Button
          label={t('notificationSettings', 'got_it')}
          variant="secondary"
          onPress={onCloseQuietHours}
        />
      </Sheet>
    </Screen>
  );
}

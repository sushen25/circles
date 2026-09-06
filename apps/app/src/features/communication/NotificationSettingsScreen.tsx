import { Body, Card, DisplayL, Screen, Small, Title, TopBar } from '../../components';
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * NotificationSettings — scaffolded from `docs/design/NotificationSettings.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type NotificationSettingsProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function NotificationSettingsScreen({ onBack }: NotificationSettingsProps) {
  return (
    <Screen>
      <TopBar
        title={t('notificationSettings', 'notifications')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <DisplayL>{t('notificationSettings', 'notifications')}</DisplayL>
        <Card>
          <Row>
            <Stack>
              <Title>{t('notificationSettings', 'sunday_crew')}</Title>
              <Small>
                {t('notificationSettings', 'new_plans_options_ready_locked_in_reminders')}
              </Small>
            </Stack>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('notificationSettings', 'quiet_asks_in_sunday_crew')}</Title>
              <Small>{t('notificationSettings', 'someone_wondering_if_people_are_keen')}</Small>
            </Stack>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('notificationSettings', 'nudges_to_plan_the_next_one')}</Title>
              <Small>{t('notificationSettings', 'only_when_its_your_turn')}</Small>
            </Stack>
          </Row>
        </Card>
        <Card>
          <Row>
            <Stack>
              <Title>{t('notificationSettings', 'quiet_hours')}</Title>
              <Small>{t('notificationSettings', '9_pm_8_am_your_time')}</Small>
            </Stack>
            <Small>{t('notificationSettings', 'change')}</Small>
          </Row>
        </Card>
        <Small>{t('notificationSettings', 'we_only_send_when_the_group_needs')}</Small>
      </Body>
    </Screen>
  );
}

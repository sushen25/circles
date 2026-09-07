import { useState } from 'react';

import { Body, Card, DisplayL, Screen, Small, Title, Toggle, TopBar } from '../../components';
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
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function NotificationSettingsScreen({ onBack }: NotificationSettingsProps) {
  const [toggle0, setToggle0] = useState(true); // Toggle
  const [toggle1, setToggle1] = useState(true); // Toggle
  const [toggle2, setToggle2] = useState(true); // Toggle

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
            <Toggle
              value={toggle0}
              onValueChange={setToggle0}
              label={t('notificationSettings', 'new_plans_options_ready_locked_in_reminders')}
            />
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('notificationSettings', 'quiet_asks_in_sunday_crew')}</Title>
              <Small>{t('notificationSettings', 'someone_wondering_if_people_are_keen')}</Small>
            </Stack>
            <Toggle
              value={toggle1}
              onValueChange={setToggle1}
              label={t('notificationSettings', 'someone_wondering_if_people_are_keen')}
            />
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('notificationSettings', 'nudges_to_plan_the_next_one')}</Title>
              <Small>{t('notificationSettings', 'only_when_its_your_turn')}</Small>
            </Stack>
            <Toggle
              value={toggle2}
              onValueChange={setToggle2}
              label={t('notificationSettings', 'only_when_its_your_turn')}
            />
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

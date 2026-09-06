import {
  Body,
  Button,
  Card,
  DisplayL,
  Input,
  Label,
  Marks,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Settings — scaffolded from `docs/design/Settings.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type SettingsProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function SettingsScreen({ fixture, onNext, onBack }: SettingsProps) {
  return (
    <Screen>
      <TopBar
        title={t('settings', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <DisplayL>{t('settings', 'circle_settings')}</DisplayL>
        <Card>
          <Label>{t('settings', 'invite_link')}</Label>
          <Input placeholder={t('settings', 'domain_join_7f3k')} />
          <Row>
            <Button label={t('settings', 'copy_link')} variant="secondary" onPress={onNext} />
            <Button label={t('settings', 'reset_link')} variant="secondary" onPress={onNext} />
          </Row>
          <Small>{t('settings', 'resetting_the_link_doesnt_affect_anyone_whos')}</Small>
        </Card>
        <Card>
          <Stack>
            <Title>{t('settings', 'catch_up')}</Title>
            <Small>{t('settings', 'about_monthly')}</Small>
          </Stack>
          <Small>{t('settings', 'change')}</Small>
          <Divider />
          <Stack>
            <Title>{t('settings', 'who_gets_nudged_to_plan_the_next')}</Title>
            <Small>{t('settings', 'take_turns')}</Small>
          </Stack>
          <Small>{t('settings', 'change')}</Small>
          <Divider />
          <Stack>
            <Title>{t('settings', 'quiet_asks')}</Title>
            <Small>{t('settings', 'on')}</Small>
          </Stack>
        </Card>
        <Stack>
          <Label>{t('settings', 'members')}</Label>
          <Card>
            <Marks members={fixture.circle.members} />
            <Stack>
              <Title>{t('settings', 'maya')}</Title>
              <Small>{t('settings', 'you_owner')}</Small>
            </Stack>
            <Divider />
            <Marks members={fixture.circle.members} />
            <Stack>
              <Title>{t('settings', 'priya')}</Title>
              <Small>{t('settings', 'joined_3_sep')}</Small>
            </Stack>
            <Small>{t('settings', 'remove')}</Small>
            <Divider />
            <Marks members={fixture.circle.members} />
            <Stack>
              <Title>{t('settings', 'alex')}</Title>
              <Small>{t('settings', 'joined_3_sep')}</Small>
            </Stack>
            <Small>{t('settings', 'remove')}</Small>
            <Divider />
            <Marks members={fixture.circle.members} />
            <Stack>
              <Title>{t('settings', 'tom')}</Title>
              <Small>{t('settings', 'joined_4_sep')}</Small>
            </Stack>
            <Small>{t('settings', 'remove')}</Small>
            <Divider />
            <Marks members={fixture.circle.members} />
            <Stack>
              <Title>{t('settings', 'jess')}</Title>
              <Small>{t('settings', 'joined_4_sep')}</Small>
            </Stack>
            <Small>{t('settings', 'remove')}</Small>
            <Divider />
            <Marks members={fixture.circle.members} />
            <Stack>
              <Title>{t('settings', 'sam')}</Title>
              <Small>{t('settings', 'joined_5_sep')}</Small>
            </Stack>
            <Small>{t('settings', 'remove')}</Small>
          </Card>
        </Stack>
        <Tertiary label={t('settings', 'archive_this_circle')} onPress={onNext} />
      </Body>
    </Screen>
  );
}

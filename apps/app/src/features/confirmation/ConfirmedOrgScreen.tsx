import {
  Body,
  BodyText,
  Button,
  Card,
  DateText,
  Foot,
  Label,
  Marks,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * ConfirmedOrg — scaffolded from `docs/design/ConfirmedOrg.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type ConfirmedOrgProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onAddToMyCalendar?: (() => void) | undefined;
  onChangeTheTimeCancel?: (() => void) | undefined;
};

export function ConfirmedOrgScreen({
  fixture,
  onNext,
  onBack,
  onAddToMyCalendar,
  onChangeTheTimeCancel,
}: ConfirmedOrgProps) {
  return (
    <Screen invert>
      <TopBar
        title={t('confirmedOrg', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Label>{t('confirmedOrg', 'locked_in')}</Label>
        <Stack>
          <DateText>{t('confirmedOrg', 'thursday_17_september')}</DateText>
          {t('confirmedOrg', '6_30_8_30_pm_hope_st')}
        </Stack>
        <Card>
          <Label>{t('confirmedOrg', 'ready_to_paste_into_the_group_chat')}</Label>
          <BodyText>{t('confirmedOrg', 'locked_in_sunday_crew_thu_17_sep')}</BodyText>
        </Card>
        <Row>
          <Stack>
            <Title>{t('confirmedOrg', '5_going_1_to_confirm')}</Title>
            <Small>{t('confirmedOrg', 'alex_hasnt_said_yet')}</Small>
          </Stack>
          <Marks members={fixture.circle.members} />
        </Row>
      </Body>
      <Foot>
        <Button label={t('confirmedOrg', 'share_to_group_chat')} onPress={onNext} />
        <Button
          label={t('confirmedOrg', 'add_to_my_calendar')}
          variant="secondary"
          onPress={onAddToMyCalendar}
        />
        <Tertiary
          label={t('confirmedOrg', 'change_the_time_cancel_this_plan')}
          onPress={onChangeTheTimeCancel}
        />
      </Foot>
    </Screen>
  );
}

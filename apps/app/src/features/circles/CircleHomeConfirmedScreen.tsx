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
  Screen,
  Small,
  TopBar,
  type Member,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { MembersLine, SettingsButton } from './parts';

/**
 * CircleHome, locked in — `docs/design/CircleHomeConfirmed.dc.html` (spec
 * §5.2): the next confirmed meetup with who is going, last caught up, and the
 * meetup as the "next one".
 *
 * "Details" opens the confirmed screen for that plan (S1-28's); "Share" puts the
 * locked-in message in the group chat. "Plan another" is the primary action,
 * secondary in weight because nothing is waiting on it.
 */
export type CircleHomeConfirmedProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  color?: string | undefined;
  subtitle?: string | undefined;
  /** "Thu 17 Sep". */
  date?: string | undefined;
  /** "6:30–8:30 pm · Hope St Radio". */
  detail?: string | undefined;
  /** "5 going · 1 to confirm". */
  going?: string | undefined;
  lastCaughtUp?: string | undefined;
  members?: readonly Member[] | undefined;
  memberCount?: string | undefined;
  /** What the last Share did, said once. */
  shareOutcome?: string | undefined;
  onInviteLink?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onDetails?: (() => void) | undefined;
  onPlanAnother?: (() => void) | undefined;
  onShare?: (() => void) | undefined;
};

export function CircleHomeConfirmedScreen({
  fixture,
  circleName = t('circleHomeConfirmed', 'sunday_crew'),
  color = 'clay',
  subtitle = t('circleHomeConfirmed', '6_members_about_monthly'),
  date = t('circleHomeConfirmed', 'thu_17_sep'),
  detail = t('circleHomeConfirmed', '6_30_8_30_pm_hope_st'),
  going = t('circleHomeConfirmed', '5_going_1_to_confirm'),
  lastCaughtUp = t('circleHomeConfirmed', 'sat_8_aug'),
  members = fixture?.circle.members ?? [],
  memberCount = t('circleHomeConfirmed', '6_members'),
  shareOutcome,
  onInviteLink,
  onSettings,
  onBack,
  onDetails,
  onPlanAnother,
  onShare,
}: CircleHomeConfirmedProps) {
  return (
    <Screen>
      <TopBar
        onBack={onBack}
        backLabel={t('common', 'back')}
        right={<SettingsButton onPress={onSettings} />}
      />
      <Body>
        <CircleHeader name={circleName} color={color} subtitle={subtitle} />
        <Card recommended>
          <Stack>
            <Label>{t('circleHomeConfirmed', 'locked_in')}</Label>
            <Small>{going}</Small>
          </Stack>
          <Stack>
            <DateText>{date}</DateText>
            <BodyText>{detail}</BodyText>
          </Stack>
          <ButtonRow>
            <Button
              label={t('circleHomeConfirmed', 'details')}
              variant="secondary"
              onPress={onDetails}
            />
            <Button
              label={t('circleHomeConfirmed', 'share')}
              variant="secondary"
              onPress={onShare}
            />
          </ButtonRow>
          {shareOutcome === undefined ? null : (
            <Small accessibilityLiveRegion="polite">{shareOutcome}</Small>
          )}
        </Card>
        <Card>
          <Row>
            <Stack>
              <Label>{t('circleHomeConfirmed', 'last_caught_up')}</Label>
              <DateText>{lastCaughtUp}</DateText>
            </Stack>
            <Stack>
              <Label>{t('circleHomeConfirmed', 'next_one')}</Label>
              <DateText>{date}</DateText>
            </Stack>
          </Row>
        </Card>
        <MembersLine members={members} memberCount={memberCount} onInviteLink={onInviteLink} />
      </Body>
      <Foot>
        <Button
          label={t('circleHomeConfirmed', 'plan_another')}
          variant="secondary"
          onPress={onPlanAnother}
        />
      </Foot>
    </Screen>
  );
}

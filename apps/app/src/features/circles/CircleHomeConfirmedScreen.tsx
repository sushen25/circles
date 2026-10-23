import type { ReactNode } from 'react';

import {
  Body,
  BodyText,
  Button,
  ButtonRow,
  Card,
  CompactButton,
  CircleHeader,
  DateText,
  Foot,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
  type Member,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { CatchUpFacts, MembersLine, SettingsButton } from './parts';

/**
 * CircleHome, locked in — `docs/design/CircleHomeConfirmed.dc.html` (spec
 * §5.2): the next confirmed meetup with who is going, last caught up, and the
 * meetup as the "next one".
 *
 * "Details" opens the confirmed screen for that plan (S1-28's) and is the
 * primary; "Send the details" puts the locked-in message in the group chat, for
 * people already in the circle (a locked-in plan's link turns newcomers away,
 * so **Add someone** sits with the members, ADR 0091). "Plan another" is a
 * quiet pill beneath: nothing is waiting on it.
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
  /** False until the circle has met: then there is no last caught up. */
  met?: boolean | undefined;
  lastCaughtUp?: string | undefined;
  members?: readonly Member[] | undefined;
  /** "Thursday Lot is full (20 people)", said in place of Add someone at the cap. */
  full?: string | undefined;
  /** What the last Send the details did, said once. */
  shareOutcome?: string | undefined;
  onAddSomeone?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onDetails?: (() => void) | undefined;
  onPlanAnother?: (() => void) | undefined;
  onShare?: (() => void) | undefined;
  /** The morning after's card, under the circle's name, when the reader owes it (S1-29). */
  prompt?: ReactNode;
};

export function CircleHomeConfirmedScreen({
  fixture,
  circleName = t('circleHomeConfirmed', 'sunday_crew'),
  color = 'clay',
  subtitle = t('circleHomeConfirmed', '6_members_about_monthly'),
  date = t('circleHomeConfirmed', 'thu_17_sep'),
  detail = t('circleHomeConfirmed', '6_30_8_30_pm_hope_st'),
  going = t('circleHomeConfirmed', '5_going_1_to_confirm'),
  met = true,
  lastCaughtUp = t('circleHomeConfirmed', 'sat_8_aug'),
  members = fixture?.circle.members ?? [],
  full,
  shareOutcome,
  onAddSomeone,
  onSettings,
  onBack,
  onDetails,
  onPlanAnother,
  onShare,
  prompt,
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
        {prompt}
        <Card recommended>
          <Stack>
            <Title>{t('circleHomeConfirmed', 'locked_in')}</Title>
            <Small>{going}</Small>
          </Stack>
          <Stack>
            <DateText>{date}</DateText>
            <BodyText>{detail}</BodyText>
          </Stack>
          <Stack>
            <ButtonRow>
              <CompactButton
                label={t('circleHomeConfirmed', 'send_the_details')}
                icon="share"
                tone="accent"
                onPress={onShare}
              />
            </ButtonRow>
            <Small>
              {t('circleHomeConfirmed', 'send_the_details_line', { circle: circleName })}
            </Small>
          </Stack>
          {shareOutcome === undefined ? null : (
            <Small accessibilityLiveRegion="polite">{shareOutcome}</Small>
          )}
        </Card>
        {met ? <CatchUpFacts lastCaughtUp={lastCaughtUp} nextOne={date} /> : null}
        <MembersLine members={members} full={full} onAddSomeone={onAddSomeone} />
      </Body>
      {/* The meetup's own step leads, "Plan another" is the quiet way on
          (SUS-197). */}
      <Foot>
        <Button label={t('circleHomeConfirmed', 'details')} onPress={onDetails} />
        <Tertiary label={t('circleHomeConfirmed', 'plan_another')} onPress={onPlanAnother} />
      </Foot>
    </Screen>
  );
}

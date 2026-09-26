import type { ReactNode } from 'react';

import {
  Body,
  Button,
  Card,
  CircleHeader,
  DateText,
  Foot,
  Label,
  Marks,
  Screen,
  Small,
  Title,
  TopBar,
  type Member,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { CircleHomeJoiningScreen } from './CircleHomeJoiningScreen';
import { MARKS_MAX, marksMore } from './lines';
import { MembersLine, SettingsButton } from './parts';

/**
 * CircleHome, finding a time — `docs/design/CircleHome.dc.html` (spec §5.2):
 * the active plan with its reply count and deadline, last caught up, next one,
 * members and the invite link, and one primary action.
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
  /** The card's label: "Finding a time", or "Started quietly" (spec §5.4). */
  label?: string | undefined;
  planTitle?: string | undefined;
  /** "Replies close Tue 15 Sep, 6 pm". */
  closes?: string | undefined;
  /** "5 of 6 replied". */
  replied?: string | undefined;
  members?: readonly Member[] | undefined;
  memberCount?: string | undefined;
  lastCaughtUp?: string | undefined;
  nextOne?: string | undefined;
  /** Offered to the owner only: the link is theirs to hand out. */
  onInviteLink?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSeeHowItsLooking?: (() => void) | undefined;
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
  members = fixture?.circle.members ?? [],
  memberCount = t('circleHome', '6_members'),
  lastCaughtUp = t('circleHome', 'sat_8_aug'),
  nextOne = t('circleHome', 'no_rush'),
  onInviteLink,
  onSettings,
  onRetry,
  onNext,
  onBack,
  onSeeHowItsLooking,
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
          {/* Stacked, not a row: "Replies close …" beside the label does not
              fit on a narrow phone (S1-27). */}
          <Stack>
            <Label>{label}</Label>
            <Small>{closes}</Small>
          </Stack>
          <Title>{planTitle}</Title>
          <Stack>
            <Marks members={members} max={MARKS_MAX} more={marksMore} />
            <Small>{replied}</Small>
          </Stack>
          <Button
            label={t('circleHome', 'see_how_its_looking')}
            variant="secondary"
            onPress={onSeeHowItsLooking}
          />
        </Card>
        <Card>
          <Row>
            <Stack>
              <Label>{t('circleHome', 'last_caught_up')}</Label>
              <DateText>{lastCaughtUp}</DateText>
            </Stack>
            <Stack>
              <Label>{t('circleHome', 'next_one')}</Label>
              <DateText>{nextOne}</DateText>
            </Stack>
          </Row>
        </Card>
        <MembersLine members={members} memberCount={memberCount} onInviteLink={onInviteLink} />
      </Body>
      <Foot>
        <Button label={t('circleHome', 'plan_a_catch_up')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

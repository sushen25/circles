import {
  Body,
  Button,
  Card,
  DateText,
  DisplayL,
  Foot,
  Label,
  Marks,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
  type Member,
} from '../../components';
import { Between, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { CircleHomeJoiningScreen } from './CircleHomeJoiningScreen';

/**
 * CircleHome, finding a time — `docs/design/CircleHome.dc.html` (spec §5.2):
 * the active plan with its reply count and deadline, last caught up, next one,
 * members and the invite link, and one primary action.
 *
 * The locked-in and about-time states are their own screens
 * (`CircleHomeConfirmedScreen`, `CircleHomeDueScreen`), owned by later tickets.
 */
export type CircleHomeProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  subtitle?: string | undefined;
  planTitle?: string | undefined;
  /** "Replies close Tue 15 Sep, 6 pm". */
  closes?: string | undefined;
  /** "5 of 6 replied". */
  replied?: string | undefined;
  members?: readonly Member[] | undefined;
  memberCount?: string | undefined;
  lastCaughtUp?: string | undefined;
  nextOne?: string | undefined;
  onInviteLink?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSeeHowItsLooking?: (() => void) | undefined;
};

export function CircleHomeScreen({
  fixture,
  state = 'default',
  circleName = t('circleHome', 'sunday_crew'),
  subtitle = t('circleHome', '6_members_about_monthly'),
  planTitle = t('circleHome', 'catch_up_in_the_next_14_days'),
  closes = t('circleHome', 'replies_close_tue_6_pm'),
  replied = t('circleHome', '5_of_6_replied'),
  members = fixture?.circle.members ?? [],
  memberCount = t('circleHome', '6_members'),
  lastCaughtUp = t('circleHome', 'sat_8_aug'),
  nextOne = t('circleHome', 'no_rush'),
  onInviteLink,
  onRetry,
  onNext,
  onBack,
  onSeeHowItsLooking,
}: CircleHomeProps) {
  if (state === 'loading' || state === 'error' || state === 'offline') {
    return <CircleHomeJoiningScreen state={state} onRetry={onRetry} onBack={onBack} />;
  }

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{circleName}</DisplayL>
          <Small>{subtitle}</Small>
        </Stack>
        <Card recommended>
          <Between>
            <Label>{t('circleHome', 'finding_a_time')}</Label>
            <Small>{closes}</Small>
          </Between>
          <Title>{planTitle}</Title>
          <Row>
            <Marks members={members} />
            <Small>{replied}</Small>
          </Row>
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
        <Between>
          <Row>
            <Marks members={members} label={members.map((m) => m.name).join(', ')} />
            <Small>{memberCount}</Small>
          </Row>
          <Tertiary label={t('circleHome', 'invite_link')} onPress={onInviteLink} />
        </Between>
      </Body>
      <Foot>
        <Button label={t('circleHome', 'plan_a_catch_up')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

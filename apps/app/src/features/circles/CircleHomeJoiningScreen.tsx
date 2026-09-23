import {
  Body,
  BodyText,
  Button,
  Card,
  CircleHeader,
  DateText,
  DisplayL,
  Foot,
  Label,
  Marks,
  Screen,
  Small,
  Tertiary,
  TopBar,
  type Member,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { MARKS_MAX, marksMore } from './lines';
import { SettingsButton } from './parts';

/**
 * CircleHomeJoining — `docs/design/CircleHomeJoining.dc.html` (spec §5.1
 * step 6): the circle filling up, and a card that says the organiser need not
 * wait for everyone.
 *
 * The flow polls while this is on screen; the screen only draws what it is
 * given. Marks here mean "who is in", not who has answered anything, so they
 * carry the names alone.
 */
export type CircleHomeJoiningProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  color?: string | undefined;
  subtitle?: string | undefined;
  members?: readonly Member[] | undefined;
  /** "Priya and Tom just joined", or undefined when nobody has lately. */
  joined?: string | undefined;
  lastCaughtUp?: string | undefined;
  nextOne?: string | undefined;
  /** False once the circle has met: then it is not the *first* catch-up. */
  firstPlan?: boolean | undefined;
  /** The owner's alone; without it there is no "Share again". */
  onShareAgain?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: plan the first catch-up. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CircleHomeJoiningScreen({
  fixture,
  state = 'default',
  circleName = t('circleHomeJoining', 'sunday_crew'),
  color = 'clay',
  subtitle = t('circleHomeJoining', '3_in_so_far_about_monthly'),
  members = fixture?.circle.members.slice(0, 3).map((m) => ({ name: m.name })) ?? [],
  joined = fixture === undefined ? undefined : t('circleHomeJoining', 'priya_and_tom_just_joined'),
  lastCaughtUp = t('circleHomeJoining', 'not_yet'),
  nextOne = t('circleHomeJoining', 'up_to_you'),
  firstPlan = true,
  onShareAgain,
  onSettings,
  onRetry,
  onNext,
  onBack,
}: CircleHomeJoiningProps) {
  if (state === 'loading') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('circleHome', 'loading')}</Small>
        </Body>
      </Screen>
    );
  }

  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayL>
            {state === 'offline'
              ? t('circleHome', 'youre_offline')
              : t('circleHome', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('circleHome', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
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
        <Card>
          <Marks
            members={members}
            max={MARKS_MAX}
            more={marksMore}
            label={members.map((m) => m.name).join(', ')}
          />
          <Small accessibilityLiveRegion="polite">
            {joined ?? t('circleHomeJoining', 'nobody_yet')}
          </Small>
          {onShareAgain === undefined ? null : (
            <Tertiary label={t('circleHomeJoining', 'share_again')} onPress={onShareAgain} />
          )}
        </Card>
        <Card recommended>
          <Label>{t('circleHomeJoining', 'ready_when_you_are')}</Label>
          <BodyText>{t('circleHomeJoining', 'you_dont_have_to_wait_for_everyone')}</BodyText>
        </Card>
        <Card>
          <Row>
            <Stack>
              <Label>{t('circleHomeJoining', 'last_caught_up')}</Label>
              <DateText>{lastCaughtUp}</DateText>
            </Stack>
            <Stack>
              <Label>{t('circleHomeJoining', 'next_one')}</Label>
              <DateText>{nextOne}</DateText>
            </Stack>
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button
          label={
            firstPlan
              ? t('circleHomeJoining', 'plan_the_first_catch_up')
              : t('circleHomeJoining', 'plan_a_catch_up')
          }
          onPress={onNext}
        />
      </Foot>
    </Screen>
  );
}

import type { ReactNode } from 'react';

import {
  Body,
  BodyText,
  Button,
  Card,
  CircleHeader,
  Foot,
  Screen,
  Title,
  TopBar,
  type Member,
  Loading,
  useLoadingHold,
} from '../../components';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { MembersLine, SettingsButton } from './parts';
import { LoadFailed } from '../system/LoadFailed';

/**
 * CircleHomeJoining — `docs/design/CircleHomeJoining.dc.html` (spec §5.1
 * step 6): the circle filling up, and a card that says the organiser need not
 * wait for everyone.
 *
 * The flow polls while this is on screen; the screen only draws what it is
 * given. Marks here mean "who is in", not who has answered anything, so they
 * carry the names alone. The card's title is who just joined; **Add someone**
 * sits with the marks, for any member (ADR 0091), and the primary is the first
 * plan, which is how everyone else joins.
 */
export type CircleHomeJoiningProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  color?: string | undefined;
  subtitle?: string | undefined;
  members?: readonly Member[] | undefined;
  /**
   * "Nina and Tom just joined", or "You and Tom just joined" for a member who is
   * one of them; undefined when nobody has lately.
   */
  joined?: string | undefined;
  /** False once the circle has met: then it is not the *first* catch-up. */
  firstPlan?: boolean | undefined;
  /** "Thursday Lot is full (20 people)": said in place of Add someone at the cap. */
  full?: string | undefined;
  /** Any member's; absent at the cap. */
  onAddSomeone?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: plan the first catch-up. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  /** The morning after's card, under the circle's name, when the reader owes it (S1-29). */
  prompt?: ReactNode;
};

export function CircleHomeJoiningScreen({
  fixture,
  state = 'default',
  circleName = t('circleHomeJoining', 'sunday_crew'),
  color = 'clay',
  subtitle = t('circleHomeJoining', '3_in_so_far_about_monthly'),
  members = fixture?.circle.members.slice(0, 3).map((m) => ({ name: m.name })) ?? [],
  joined = fixture === undefined ? undefined : t('circleHomeJoining', 'nina_and_tom_just_joined'),
  firstPlan = true,
  full,
  onAddSomeone,
  onSettings,
  onRetry,
  onNext,
  onBack,
  prompt,
}: CircleHomeJoiningProps) {
  const loading = useLoadingHold(state === 'loading');
  if (loading) {
    return (
      <Loading
        message={t('circleHome', 'loading')}
        shape="home"
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }

  if (state === 'error' || state === 'offline') {
    return (
      <LoadFailed
        state={state}
        message={t('circleHome', state === 'offline' ? 'youre_offline' : 'couldnt_load')}
        where="circles"
        onBack={onBack}
        onRetry={onRetry}
      />
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
        {prompt}
        <Card>
          <Title accessibilityLiveRegion="polite">
            {joined ?? t('circleHomeJoining', 'ready_when_you_are')}
          </Title>
          <BodyText>{t('circleHomeJoining', 'you_dont_have_to_wait_for_everyone')}</BodyText>
        </Card>
        <MembersLine members={members} full={full} onAddSomeone={onAddSomeone} />
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

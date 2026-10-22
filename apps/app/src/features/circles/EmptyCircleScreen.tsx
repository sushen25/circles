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
} from '../../components';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { MembersLine, SettingsButton } from './parts';

/**
 * EmptyCircle — `docs/design/EmptyCircle.dc.html`: a circle with nobody in it
 * but its owner (spec §5.2). The plan is how friends join (ADR 0022), so
 * planning leads; **Add someone** sits with the one mark, for the day somebody
 * would rather be invited (ADR 0091). Nothing about last caught up or a next
 * one: the circle has not met.
 *
 * The invitation itself is shown on the Add someone screen, which is where it
 * goes: a secret is never drawn on a screen that did not have to.
 */
export type EmptyCircleProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  color?: string | undefined;
  subtitle?: string | undefined;
  members?: readonly Member[] | undefined;
  onSettings?: (() => void) | undefined;
  /** The screen's one decision: plan a catch-up. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  /** Any member's; the circle's invitation. */
  onAddSomeone?: (() => void) | undefined;
  /**
   * The morning after's card (S1-29): everybody else can have left since the
   * meetup, and the organiser still owes the answer.
   */
  prompt?: ReactNode;
};

export function EmptyCircleScreen({
  fixture,
  circleName = t('emptyCircle', 'sunday_crew'),
  color = 'clay',
  subtitle = t('emptyCircle', 'just_you_so_far'),
  members = fixture?.circle.members.slice(0, 1).map((m) => ({ name: m.name })) ?? [],
  onSettings,
  onNext,
  onBack,
  onAddSomeone,
  prompt,
}: EmptyCircleProps) {
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
          <Title>{t('emptyCircle', 'just_you_so_far')}</Title>
          <BodyText>{t('emptyCircle', 'plan_and_share')}</BodyText>
        </Card>
        <MembersLine members={members} onAddSomeone={onAddSomeone} />
      </Body>
      <Foot>
        <Button label={t('emptyCircle', 'plan_a_catch_up')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

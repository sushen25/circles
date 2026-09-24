import type { ReactNode } from 'react';

import {
  Body,
  BodyText,
  Button,
  Card,
  CircleHeader,
  Foot,
  Label,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { SettingsButton } from './parts';

/**
 * EmptyCircle — `docs/design/EmptyCircle.dc.html`: a circle with nobody in it
 * but its owner (spec §5.2). The link is the only useful thing, so sharing it
 * is the primary action; planning anyway is offered, because anyone who joins
 * later can still add their times.
 *
 * The link itself is shown on the invite screen, which is where "Share invite
 * link" goes: a secret is never drawn on a screen that did not have to.
 */
export type EmptyCircleProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  color?: string | undefined;
  subtitle?: string | undefined;
  onSettings?: (() => void) | undefined;
  /** The screen's one decision: share the invite link. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onPlanACatchUp?: (() => void) | undefined;
  /**
   * The morning after's card (S1-29): everybody else can have left since the
   * meetup, and the organiser still owes the answer.
   */
  prompt?: ReactNode;
};

export function EmptyCircleScreen({
  circleName = t('emptyCircle', 'sunday_crew'),
  color = 'clay',
  subtitle = t('emptyCircle', 'just_you_so_far'),
  onSettings,
  onNext,
  onBack,
  onPlanACatchUp,
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
          <Label>{t('emptyCircle', 'invite_link')}</Label>
          <BodyText>{t('emptyCircle', 'paste_this_into_the_group_chat_friends')}</BodyText>
        </Card>
        <Small>{t('emptyCircle', 'you_can_start_a_plan_now_too')}</Small>
      </Body>
      <Foot>
        <Button label={t('emptyCircle', 'share_invite_link')} onPress={onNext} />
        <Button
          label={t('emptyCircle', 'plan_a_catch_up_anyway')}
          variant="secondary"
          onPress={onPlanACatchUp}
        />
      </Foot>
    </Screen>
  );
}

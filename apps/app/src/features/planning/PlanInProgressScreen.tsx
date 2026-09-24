import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Screen,
  Small,
  Title,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * PlanSetup, when the circle already has a plan finding a time (spec §5.3,
 * ADR 00XX). One open plan per circle: rather than a form whose "Ask the
 * group" the server would refuse, the screen names the plan that is running —
 * its title, when its replies close, how many have answered — and offers the
 * two things an organiser can do about it, both S1-26's screens.
 *
 * Reached from circle home's "Plan a catch-up", from `/plan/setup` and
 * `/plan/window` directly, and from FirstPlan's "Change"; the flow decides,
 * from the circle it read, which of the two it draws.
 */
export type PlanInProgressProps = {
  circleName: string;
  planTitle: string;
  /** "Replies close Tue 15 Sep, 6 pm". */
  closes: string;
  /** "5 of 6 replied". */
  replied: string;
  onEdit?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function PlanInProgressScreen(props: PlanInProgressProps) {
  return (
    <Screen>
      <TopBar
        title={t('planSetup', 'plan_openly')}
        onBack={props.onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('planSetup', 'in_progress_title', { circle: props.circleName })}</DisplayL>
          <BodyText>{t('planSetup', 'in_progress_body')}</BodyText>
        </Stack>
        <Card recommended>
          <Small>{props.closes}</Small>
          <Title>{props.planTitle}</Title>
          <Small>{props.replied}</Small>
        </Card>
      </Body>
      <Foot>
        <Button label={t('planSetup', 'in_progress_edit')} onPress={props.onEdit} />
        <Button
          label={t('planSetup', 'in_progress_cancel')}
          variant="secondary"
          onPress={props.onCancel}
        />
      </Foot>
    </Screen>
  );
}

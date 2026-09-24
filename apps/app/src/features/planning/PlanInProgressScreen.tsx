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
  /**
   * Who the reader is to this plan. Edit is the organiser's; Cancel is the
   * organiser's or the owner's (spec §4.5). A button that leads only to a
   * refusal is not offered, and the body says whose plan it is instead.
   */
  canEdit: boolean;
  canCancel: boolean;
  /** The organiser's name, for a reader who is not them. */
  organiserName?: string | undefined;
  onEdit?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  /** The candidates screen: how it is looking, for anybody in the circle. */
  onSeeHowItsLooking?: (() => void) | undefined;
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
          <BodyText>
            {props.canEdit
              ? t('planSetup', 'in_progress_body')
              : t('planSetup', 'in_progress_theirs', {
                  name: props.organiserName ?? t('planSetup', 'someone'),
                })}
          </BodyText>
        </Stack>
        <Card recommended>
          <Small>{props.closes}</Small>
          <Title>{props.planTitle}</Title>
          <Small>{props.replied}</Small>
        </Card>
      </Body>
      <Foot>
        {props.canEdit ? (
          <Button label={t('planSetup', 'in_progress_edit')} onPress={props.onEdit} />
        ) : null}
        {props.canCancel ? (
          <Button
            label={t('planSetup', 'in_progress_cancel')}
            variant="secondary"
            onPress={props.onCancel}
          />
        ) : null}
        <Button
          label={t('circleHome', 'see_how_its_looking')}
          variant={props.canEdit ? 'secondary' : 'primary'}
          onPress={props.onSeeHowItsLooking}
        />
      </Foot>
    </Screen>
  );
}

import { ButtonRow, CompactButton, Foot, Small } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * What the organiser does about the plan itself, set beside the plan's facts
 * in the header (SUS-161): share the link again and edit it. They are about the
 * plan rather than the decision, so they scroll away as the options are read.
 * "Change my times" is the organiser's own answer, which they may want while
 * reading the options, so it lives in the footer (`ChangeMyTimes`, below).
 *
 * Compact buttons in a wrapping row, so at 200% type they sit on two lines
 * rather than clipping. The line that follows a share ("Copied. …") stays next
 * to the share button, as a live region.
 */
export type PlanActionsProps = {
  /** The plan's link again, while replies are open (SUS-132). */
  onShareAgain?: (() => void) | undefined;
  /** What sharing did when it copied rather than opened a sheet. */
  shareOutcome?: string | undefined;
  /** The organiser changes the plan while it is still asking (S1-26). */
  onEditPlan?: (() => void) | undefined;
};

export function PlanActions({ onShareAgain, shareOutcome, onEditPlan }: PlanActionsProps) {
  if (onShareAgain === undefined && onEditPlan === undefined) return null;

  return (
    <Stack gap={8}>
      <ButtonRow>
        {onShareAgain === undefined ? null : (
          <CompactButton
            label={t('waiting', 'share_the_link_again')}
            icon="share"
            onPress={onShareAgain}
          />
        )}
        {onEditPlan === undefined ? null : (
          <CompactButton label={t('waiting', 'edit_the_plan')} onPress={onEditPlan} />
        )}
      </ButtonRow>
      {shareOutcome === undefined ? null : (
        <Small accessibilityLiveRegion="polite">{shareOutcome}</Small>
      )}
    </Stack>
  );
}

export type ChangeMyTimesProps = {
  /** The organiser's own answer, opened as a member's is (SUS-158). */
  onChangeMyTimes?: (() => void) | undefined;
  /**
   * Replies have closed: "Change my times" stays, disabled, with the member's
   * line saying why, because `replace_response` refuses an answer then and a
   * button that vanished left people looking for it.
   */
  repliesClosed?: boolean | undefined;
};

/** Whether the footer has a "Change my times" to show. */
export const hasChangeMyTimes = ({ onChangeMyTimes, repliesClosed }: ChangeMyTimesProps) =>
  repliesClosed === true || onChangeMyTimes !== undefined;

/** The compact button itself, for a footer row that may hold a nudge beside it. */
export function ChangeMyTimesButton({
  onChangeMyTimes,
  repliesClosed = false,
}: ChangeMyTimesProps) {
  const label = t('candidatesMember', 'change_my_times');
  if (repliesClosed) return <CompactButton label={label} disabled />;
  if (onChangeMyTimes === undefined) return null;
  return <CompactButton label={label} onPress={onChangeMyTimes} />;
}

/** Why it is disabled, under the footer's row. */
export function ChangeMyTimesNote({ repliesClosed = false }: ChangeMyTimesProps) {
  return repliesClosed ? (
    <Small style={{ textAlign: 'center' }}>{t('candidatesMember', 'closed_note')}</Small>
  ) : null;
}

/**
 * The footer of a screen that has no decision of its own (Waiting, No
 * overlap): "Change my times" alone, centred, the height of a nudge row.
 */
export function ChangeMyTimesFoot(props: ChangeMyTimesProps) {
  if (!hasChangeMyTimes(props)) return null;
  return (
    <Foot>
      <ButtonRow center>
        <ChangeMyTimesButton {...props} />
      </ButtonRow>
      <ChangeMyTimesNote {...props} />
    </Foot>
  );
}

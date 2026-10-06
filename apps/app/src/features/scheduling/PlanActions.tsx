import { ButtonRow, CompactButton, Small } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * What the organiser does about the plan itself, set beside the plan's facts
 * in the header (SUS-161): share the link again, edit it, change their own
 * times. They are about the plan rather than the decision, so they scroll away
 * as the options are read and the footer is left to the decision.
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
  /** The organiser's own answer, opened as a member's is (SUS-158). */
  onChangeMyTimes?: (() => void) | undefined;
  /**
   * Replies have closed: "Change my times" stays, disabled, with the member's
   * line saying why, because `replace_response` refuses an answer then and a
   * button that vanished left people looking for it.
   */
  repliesClosed?: boolean | undefined;
};

export function PlanActions({
  onShareAgain,
  shareOutcome,
  onEditPlan,
  onChangeMyTimes,
  repliesClosed = false,
}: PlanActionsProps) {
  const change = t('candidatesMember', 'change_my_times');
  const hasChange = repliesClosed || onChangeMyTimes !== undefined;
  if (onShareAgain === undefined && onEditPlan === undefined && !hasChange) return null;

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
        {!hasChange ? null : repliesClosed ? (
          <CompactButton label={change} disabled />
        ) : (
          <CompactButton label={change} onPress={onChangeMyTimes} />
        )}
      </ButtonRow>
      {shareOutcome === undefined ? null : (
        <Small accessibilityLiveRegion="polite">{shareOutcome}</Small>
      )}
      {repliesClosed ? <Small>{t('candidatesMember', 'closed_note')}</Small> : null}
    </Stack>
  );
}

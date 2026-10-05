import { Body, Button, DisplayL, Foot, Notice, Screen, Small, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * FinishDraft — the moment after the place is saved and the name is in, while
 * the circle and the plan the organiser drafted are made (ADR 0053). It is
 * seen for a second, or not at all; it exists for the second it is slow and for
 * the time it fails, so that what was chosen is never lost without a word.
 */
export type FinishDraftProblem =
  'too_many_tries' | 'couldnt_set_up' | 'offline' | 'too_late' | 'time_passed';

export type FinishDraftProps = {
  circleName?: string | undefined;
  problem?: FinishDraftProblem | undefined;
  reference?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** For `too_late` and `time_passed`: back to the plan's card, to pick a time that is still open. */
  onChangeTime?: (() => void) | undefined;
};

function problemCopy(problem: FinishDraftProblem, circle: string): string {
  switch (problem) {
    case 'too_many_tries':
      return t('finish', 'too_many_tries');
    case 'offline':
      return t('finish', 'youre_offline');
    case 'too_late':
      return t('firstPlan', 'too_late_for_tonight');
    case 'time_passed':
      return t('finish', 'time_passed');
    case 'couldnt_set_up':
      return t('finish', 'couldnt_set_up', { circle });
  }
}

export function FinishDraftScreen({
  circleName = '',
  problem,
  reference,
  onRetry,
  onChangeTime,
}: FinishDraftProps) {
  return (
    <Screen>
      <TopBar title={circleName} />
      <Body>
        {problem === undefined ? (
          <Small accessibilityLiveRegion="polite">
            {t('finish', 'setting_up', { circle: circleName })}
          </Small>
        ) : (
          <Stack>
            <DisplayL>{circleName}</DisplayL>
            <Notice kind="warn">{problemCopy(problem, circleName)}</Notice>
            {reference === undefined ? null : (
              <Small>{t('finish', 'reference', { reference })}</Small>
            )}
          </Stack>
        )}
      </Body>
      {problem === undefined ? null : (
        <Foot>
          {problem === 'too_late' || problem === 'time_passed' ? (
            <Button label={t('finish', 'change_the_time')} onPress={onChangeTime} />
          ) : (
            <Button label={t('finish', 'try_again')} onPress={onRetry} />
          )}
        </Foot>
      )}
    </Screen>
  );
}

import { QUIET_LIMITS } from '@circles/domain';

import { t } from '../../copy';
import { failureOf } from '../identity/join/failure';
import { refusalOf, type Refused } from './problems';

/**
 * A refusal from `create-plan` (quiet), `answer-interest` or
 * `accept-organiser`, as a sentence (S2-02's codes).
 *
 * **Each is copy only, and about the reader.** No sentence here says anything
 * about anybody else — not who asked, not who answered, not who took the role
 * — and `already_asking` is shown only on the screen of the person it is
 * about: the one who just tried to start a second ask (SUS-49).
 *
 * Anything that is not a quiet code is the planning screens' (`refusalOf`).
 */
export type QuietRefused = Refused & {
  /** `interest_closed`, `already_taken`, `wrong_state`: read the view again. */
  reread?: boolean | undefined;
};

export function quietRefusalOf(
  error: unknown,
  context: { circleName?: string | undefined } = {},
): QuietRefused {
  const circle = context.circleName ?? t('quiet', 'this_circle');
  const failure = failureOf(error);
  if (failure.kind !== 'reason') return refusalOf(error, context);
  const settled = (message: string, extra: Partial<QuietRefused> = {}): QuietRefused => ({
    message,
    conclusive: true,
    ...extra,
  });
  switch (failure.reason) {
    case 'quiet_asks_muted':
      return settled(t('quiet', 'refused_muted', { circle }));
    case 'already_asking':
      return settled(t('quiet', 'refused_already_asking', { circle }));
    case 'circle_ask_limit':
      return settled(t('quiet', 'refused_circle_limit', { circle, count: QUIET_LIMITS.perCircle }));
    case 'nobody_to_ask':
      return settled(t('quiet', 'refused_nobody', { circle }));
    case 'stop_time_unavailable':
      return settled(t('quiet', 'refused_stop_time'), { stale: true });
    case 'interest_closed':
    case 'initiator_is_keen':
      return settled(t('quiet', 'refused_interest_closed'), { reread: true });
    case 'already_taken':
      return settled(t('quiet', 'refused_taken'), { reread: true });
    case 'not_keen':
      return settled(t('quiet', 'refused_not_keen'), { reread: true });
    case 'deadline_not_passed':
      return settled(t('quiet', 'refused_deadline_not_passed'), { reread: true });
    case 'wrong_state':
      return settled(t('quiet', 'refused_wrong_state'), { reread: true });
    default:
      return refusalOf(error, context);
  }
}

import { t } from '../../copy';
import { failureOf } from '../identity/join/failure';
import type { ResolveProblem } from './form';
import { problemWords } from './words';

/**
 * A refusal from `create-plan`, `revise-plan` or `cancel-plan`, as a sentence
 * (S1-15's list of `ProblemReason`s). Read from `Problem.reason`, never the
 * message: a copy edit on the server must not be able to change a screen
 * (architecture §9.1). Anything unrecognised is "something went wrong" with a
 * reference to quote, never the server's own words.
 */
export type Refused = {
  message: string;
  reference?: string | undefined;
  /**
   * The server answered with a reason: this request is settled, and the next
   * tap is a new one. Anything else — offline, a dropped response, a 500 —
   * may have landed, so the next tap has to be **the same request, with the
   * same key**, and get the first one's answer (ADR 0016).
   */
  conclusive: boolean;
  /** `preview_is_stale`: fetch the preview again before anything else. */
  stale?: boolean | undefined;
  /** `requires_saved_place`: the organiser gate (ADR 0004). */
  needsSavedPlace?: boolean | undefined;
};

const DOMAIN: readonly string[] = [
  'too_late_for_tonight',
  'window_too_long',
  'window_backwards',
  'window_has_passed',
  'band_shorter_than_meetup',
  'band_backwards',
  'band_unaligned',
  'band_out_of_day',
  'deadline_out_of_range',
];

export function refusalOf(error: unknown): Refused {
  const failure = failureOf(error);
  if (failure.kind === 'offline') {
    return { message: t('planSetup', 'problem_offline'), conclusive: false };
  }
  if (failure.kind === 'unknown') {
    return {
      message: t('planSetup', 'problem_generic'),
      reference: failure.reference,
      conclusive: false,
    };
  }
  return { ...refusalFor(failure.reason, failure.reference), conclusive: true };
}

function refusalFor(reason: string, reference: string | undefined): Omit<Refused, 'conclusive'> {
  if (DOMAIN.includes(reason)) return { message: problemWords(reason as ResolveProblem) };
  switch (reason) {
    case 'preview_is_stale':
      return { message: t('planSetup', 'problem_stale'), stale: true };
    case 'requires_saved_place':
      return { message: t('planSetup', 'problem_generic'), needsSavedPlace: true };
    case 'too_many_requests':
      return { message: t('planSetup', 'problem_too_many') };
    case 'not_the_organiser':
      return { message: t('planSetup', 'problem_not_organiser') };
    case 'not_the_organiser_or_owner':
      return { message: t('cancelPlan', 'not_yours') };
    case 'plan_is_finished':
      return { message: t('planSetup', 'problem_finished') };
    case 'wrong_state':
      return { message: t('planSetup', 'problem_wrong_state') };
    case 'not_a_participant':
      return { message: t('planSetup', 'problem_not_a_participant') };
    case 'nothing_to_change':
      return { message: t('planSetup', 'problem_nothing') };
    case 'circle_archived':
      return { message: t('planSetup', 'problem_archived') };
    case 'plan_not_found':
    case 'circle_not_found':
      return { message: t('planSetup', 'not_found') };
    default:
      return { message: t('planSetup', 'problem_generic'), reference };
  }
}

import { FunctionError } from '../../../data/functions';
import { isOffline, neverReachedServer } from '../../../data/reach';

export { isOffline, neverReachedServer };

/**
 * How a failed call reads to a person: a reason a screen can act on, offline,
 * or something went wrong with a reference to quote.
 *
 * Offline is `neverReachedServer` (`data/reach.ts`): the device says so, or the
 * call failed before anything answered. A server that answered, a 5xx included,
 * is "something went wrong" with a reference, because reconnecting fixes nothing.
 */
export type Failure =
  | { kind: 'reason'; reason: string; reference: string | undefined }
  | { kind: 'offline' }
  | { kind: 'unknown'; reference: string | undefined };

export function failureOf(error: unknown): Failure {
  if (neverReachedServer(error)) return { kind: 'offline' };
  if (error instanceof FunctionError) {
    if (error.reason !== undefined) {
      return { kind: 'reason', reason: error.reason, reference: error.reference };
    }
    return { kind: 'unknown', reference: error.reference };
  }
  return { kind: 'unknown', reference: undefined };
}

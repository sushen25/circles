import { FunctionError } from '../../../data/functions';

/**
 * How a failed call reads to a person: a reason a screen can act on, offline,
 * or something went wrong with a reference to quote.
 *
 * Offline is read from the browser as well as from the error, because a fetch
 * that never left the device throws the same shape as one the server dropped,
 * and only one of them is fixed by reconnecting.
 */
export type Failure =
  | { kind: 'reason'; reason: string; reference: string | undefined }
  | { kind: 'offline' }
  | { kind: 'unknown'; reference: string | undefined };

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function failureOf(error: unknown): Failure {
  if (isOffline()) return { kind: 'offline' };
  if (error instanceof FunctionError) {
    if (error.reason !== undefined) {
      return { kind: 'reason', reason: error.reason, reference: error.reference };
    }
    return { kind: 'unknown', reference: error.reference };
  }
  return { kind: 'unknown', reference: undefined };
}

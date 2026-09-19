import type { IdempotencyKey } from '@circles/contracts';
import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
import { useRef, useState } from 'react';

import { newIdempotencyKey } from '../../../data/functions';
import type { NameProblem } from '../NameScreen';
import { failureOf } from './failure';

/**
 * The name step, whichever door it is in front of.
 *
 * A guest types a name and it is sent to a join: `redeem-invite` from an
 * invite link, `join-plan` from a plan's (ADR 0022). The two differ in what
 * they send it with and where they go afterwards, and nothing else — the
 * refusals are the same reasons, and the rule about keys is the same rule — so
 * the part that is the same is here, once.
 *
 * Every refusal is branched on by `Problem.reason`, never by message, and all
 * but one keep the person here: they can type a different name, or wait.
 * `invite_inactive` is the exception, because no name fixes a way in that has
 * closed; the caller decides what that looks like.
 */

const REASONS: Record<string, NameProblem> = {
  duplicate_name: 'name_taken',
  display_name_unusable: 'name_unusable',
  circle_full: 'circle_full',
  too_many_requests: 'too_many_tries',
};

export interface NameStepOptions<T> {
  /** The join itself, under this name and this name's key. */
  join: (displayName: string, idempotencyKey: IdempotencyKey) => Promise<T>;
  /** It went through. Navigation is the caller's. */
  onJoined: (result: T) => void | Promise<void>;
  /** The way in has closed: an invite reset, or a plan no longer asking. */
  onInactive: () => void;
  /** A name to start from, such as an account's own after a `duplicate_name`. */
  initialName?: string;
  /** A problem to open with, for arriving here because a name was refused. */
  initialProblem?: NameProblem;
  initialRefusedName?: string;
}

export interface NameStep {
  name: string;
  busy: boolean;
  problem: NameProblem | undefined;
  refusedName: string;
  reference: string | undefined;
  onChangeText: (text: string) => void;
  submit: () => Promise<void>;
}

export function useNameStep<T>({
  join,
  onJoined,
  onInactive,
  initialName = '',
  initialProblem,
  initialRefusedName = '',
}: NameStepOptions<T>): NameStep {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<NameProblem | undefined>(initialProblem);
  const [refusedName, setRefusedName] = useState(initialRefusedName);
  const [reference, setReference] = useState<string | undefined>();

  /**
   * One idempotency key per *name*, not per tap (ADR 0016).
   *
   * A retry of the same name must reuse its key, so that "did my first tap
   * land?" is answered by the server rather than by a second membership. A
   * different name is a different request, and sending it under the old key is
   * an `idempotency_mismatch` — which would make the duplicate-name path, the
   * whole point of this step's refusals, impossible to recover from.
   */
  const keys = useRef(new Map<string, IdempotencyKey>());

  const submit = async () => {
    const displayName = normaliseDisplayName(name);
    if (displayName === '' || busy) return;
    // The domain's rule, the same one the request schema applies. Asking the
    // server would get `invalid_request` with no reason — a generic error for
    // something the person can fix by typing.
    if (!isValidDisplayName(displayName)) {
      setProblem('name_unusable');
      return;
    }

    let key = keys.current.get(displayName);
    if (key === undefined) {
      key = newIdempotencyKey();
      keys.current.set(displayName, key);
    }

    setBusy(true);
    setProblem(undefined);
    setReference(undefined);

    try {
      const result = await join(displayName, key);
      await onJoined(result);
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === 'reason' && failure.reason === 'invite_inactive') {
        onInactive();
        return;
      }
      if (failure.kind === 'offline') {
        setProblem('offline');
      } else if (failure.kind === 'reason' && REASONS[failure.reason] !== undefined) {
        setProblem(REASONS[failure.reason]);
        setRefusedName(displayName);
      } else {
        setProblem('couldnt_join');
        setReference(failure.reference);
      }
    } finally {
      setBusy(false);
    }
  };

  return {
    name,
    busy,
    problem,
    refusedName,
    reference,
    onChangeText: (text) => {
      setName(text);
      // A name being edited is no longer the name that was refused.
      if (problem === 'name_taken' || problem === 'name_unusable') setProblem(undefined);
    },
    submit,
  };
}

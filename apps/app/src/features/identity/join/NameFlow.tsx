import type { IdempotencyKey } from '@circles/contracts';
import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { track } from '../../../analytics/track';
import { newIdempotencyKey } from '../../../data/functions';
import {
  arrivalFor,
  fetchInvitePreview,
  heldInvite,
  redeemInvite,
  releaseInvite,
} from '../../../data/membership';
import { LinkInvalidScreen } from '../LinkInvalidScreen';
import { NameScreen, type NameProblem } from '../NameScreen';
import { failureOf } from './failure';

/**
 * `/join/name` — the one thing a guest types (spec §5.1).
 *
 * Every refusal `redeem-invite` can give is branched on by `Problem.reason`,
 * never by message, and all but one keep the person here: they can type a
 * different name, or wait. `invite_inactive` is the exception, because no name
 * fixes a link that has stopped working.
 */

const REASONS: Record<string, NameProblem> = {
  duplicate_name: 'name_taken',
  display_name_unusable: 'name_unusable',
  circle_full: 'circle_full',
  too_many_requests: 'too_many_tries',
};

export function NameFlow() {
  const router = useRouter();
  // Read once. Joining releases the invite, and the render between that and the
  // navigation must not mistake a finished join for a lost link.
  const [secret] = useState(heldInvite);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<NameProblem | undefined>();
  const [refusedName, setRefusedName] = useState('');
  const [reference, setReference] = useState<string | undefined>();
  const [inactive, setInactive] = useState(false);

  /**
   * One idempotency key per *name*, not per tap (ADR 0016).
   *
   * A retry of the same name must reuse its key, so that "did my first tap
   * land?" is answered by the server rather than by a second membership. A
   * different name is a different request, and sending it under the old key is
   * an `idempotency_mismatch` — which would make the duplicate-name path, the
   * whole point of this screen's refusals, impossible to recover from.
   */
  const keys = useRef(new Map<string, IdempotencyKey>());

  const preview = useQuery({
    queryKey: ['invite-preview'],
    queryFn: () => fetchInvitePreview(secret as string),
    enabled: secret !== undefined,
    staleTime: Infinity,
    gcTime: 0,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const whatIsBrand = () => router.push('/get-the-app');

  if (secret === undefined) {
    return <LinkInvalidScreen reason="open_again" onBack={back} onWhatIsBrand={whatIsBrand} />;
  }
  if (inactive || preview.data === null) {
    return <LinkInvalidScreen reason="inactive" onBack={back} onWhatIsBrand={whatIsBrand} />;
  }

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
      const joined = await redeemInvite({ secret, displayName, idempotencyKey: key });
      releaseInvite();
      track('circle_joined', {});

      const arrival = await arrivalFor(joined.circle.id).catch(() => ({
        kind: 'circle' as const,
        id: joined.circle.id,
      }));
      // `replace`, so Back from the plan does not return to a form that has
      // already been submitted.
      if (arrival.kind === 'plan') {
        router.replace({ pathname: '/j/[code]', params: { code: arrival.code } });
      } else {
        router.replace({ pathname: '/circles/[id]', params: { id: arrival.id } });
      }
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === 'reason' && failure.reason === 'invite_inactive') {
        releaseInvite();
        setInactive(true);
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

  return (
    <NameScreen
      circleName={preview.data?.circle_name ?? ''}
      inviterName={preview.data?.inviter_name ?? null}
      value={name}
      refusedName={refusedName}
      problem={problem}
      reference={reference}
      busy={busy}
      onChangeText={(text) => {
        setName(text);
        // A name being edited is no longer the name that was refused.
        if (problem === 'name_taken' || problem === 'name_unusable') setProblem(undefined);
      }}
      onNext={() => void submit()}
      onBack={back}
    />
  );
}

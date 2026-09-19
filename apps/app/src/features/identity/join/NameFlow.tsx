import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { track } from '../../../analytics/track';
import {
  arrivalFor,
  fetchInvitePreview,
  heldInvite,
  redeemInvite,
  releaseInvite,
} from '../../../data/membership';
import { LinkInvalidScreen } from '../LinkInvalidScreen';
import { NameScreen } from '../NameScreen';
import { useNameStep } from './useNameStep';

/**
 * `/join/name` — the one thing a guest types (spec §5.1), in front of
 * `redeem-invite`. The refusals and the one-key-per-name rule are
 * `useNameStep`'s, shared with joining from a plan link.
 */

export function NameFlow() {
  const router = useRouter();
  // Read once. Joining releases the invite, and the render between that and the
  // navigation must not mistake a finished join for a lost link.
  const [secret] = useState(heldInvite);
  const [inactive, setInactive] = useState(false);

  const step = useNameStep({
    join: (displayName, idempotencyKey) =>
      redeemInvite({ secret: secret as string, displayName, idempotencyKey }),
    onJoined: async (joined) => {
      releaseInvite();
      track('circle_joined', { circle_id: joined.circle.id, source: 'invite' });

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
    },
    onInactive: () => {
      releaseInvite();
      setInactive(true);
    },
  });

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

  return (
    <NameScreen
      circleName={preview.data?.circle_name ?? ''}
      inviterName={preview.data?.inviter_name ?? null}
      value={step.name}
      refusedName={step.refusedName}
      problem={step.problem}
      reference={step.reference}
      busy={step.busy}
      onChangeText={step.onChangeText}
      onNext={() => void step.submit()}
      onBack={back}
    />
  );
}

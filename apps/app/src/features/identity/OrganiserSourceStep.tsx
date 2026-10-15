import { type OrganiserSource } from '@circles/contracts';
import { useEffect, useRef } from 'react';

import { track } from '../../analytics/track';
import { useSession } from '../../data/auth';
import { WelcomeScreen } from './WelcomeScreen';
import { useNudge } from '../growth/useNudge';
import { OrganiserSourceScreen } from './OrganiserSourceScreen';

/**
 * The question after the organiser's code is accepted (SUS-171), shown once per
 * account and never in the way.
 *
 * "Once per account" is `record-nudge`'s `organiser_source` row, which says the
 * account was asked and holds no answer. The answer goes only to the analytics
 * event, with nothing else in it. A server that cannot be asked, an account that
 * has been asked before and a device with no backend all read as `skip`, and the
 * person is on their way without having seen anything: nothing blocks on this.
 */
export function OrganiserSourceStep({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const nudge = useNudge('organiser_source');
  const left = useRef(false);
  const leave = () => {
    if (left.current) return;
    left.current = true;
    onDone();
  };

  useEffect(() => {
    // A session still being read is not an answer: the sign-in has just landed.
    if (nudge.showing === 'skip' && !session.isLoading) leave();
    // `leave` only reads a ref and the parent's callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge.showing, session.isLoading]);

  if (nudge.showing !== 'show') return <WelcomeScreen state="loading" />;

  return (
    <OrganiserSourceScreen
      onChoose={(source: OrganiserSource) => {
        if (left.current) return;
        track('organiser_source', { source });
        leave();
      }}
    />
  );
}

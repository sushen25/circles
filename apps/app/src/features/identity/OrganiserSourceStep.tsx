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
 * event, with nothing else in it; the account's own row says only that the
 * question was answered, the same for every choice, so it cannot be asked again
 * on this device after a sign-out either. A server that cannot be asked, an account that
 * has been asked before and a device with no backend all read as `skip`, and the
 * person is on their way without having seen anything: nothing blocks on this.
 */
/** How long the question may take to be asked before the person is sent on without it. */
const WAIT_MS = 4000;

export function OrganiserSourceStep({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const nudge = useNudge('organiser_source');
  const left = useRef(false);
  const leave = () => {
    if (left.current) return;
    left.current = true;
    onDone();
  };

  // A server that cannot be reached (React Query pauses the question while the
  // browser is offline, and it then never answers) is not a reason to hold
  // somebody on a loading screen: this is the one optional thing on the way.
  // Also the session not yet being the new organiser's: on a device that
  // publishes the signed-in session late, the person is still `none` for a moment
  // and a skip said then is not the answer for them.
  const pending = nudge.showing === 'pending' || session.userId === undefined;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(leave, WAIT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  useEffect(() => {
    // A session still being read is not an answer: the sign-in has just landed.
    if (nudge.showing === 'skip' && !session.isLoading && session.userId !== undefined) leave();
    // `leave` only reads a ref and the parent's callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge.showing, session.isLoading, session.userId]);

  if (nudge.showing !== 'show') return <WelcomeScreen state="loading" />;

  return (
    <OrganiserSourceScreen
      onChoose={(source: OrganiserSource) => {
        if (left.current) return;
        track('organiser_source', { source });
        // Answered, as far as this session is concerned, whichever way: a chip
        // and Skip are recorded alike on the account, which says it was asked
        // and nothing about what it said. The event is the only place a source is.
        nudge.tap();
        leave();
      }}
    />
  );
}

import { useEffect, useState } from 'react';

import { hasBackend } from '../../data/auth/client';
import { stopNudges } from '../../data/email';
import { heldToken, releaseToken } from '../../data/links/tokens';
import { failureOf } from '../identity/join/failure';
import { NudgeStopScreen, type NudgeStopState } from './NudgeStopScreen';

/**
 * `/n#<token>` — stop the cadence nudge, with no sign-in (ADR 0067, ADR 0023).
 *
 * The token is held for this screen alone and is posted only when the person
 * taps. Nothing is read on load: a page that stopped the reminders as it
 * opened would let a mail gateway that fetches and runs links do it for them
 * (SUS-186). Nothing is tracked: no event carries the token or says whose it
 * is.
 */
export function NudgeStopFlow() {
  const [token] = useState(() => heldToken('nudge_stop'));
  // Taken for this screen alone: the held copy goes (ADR 0023).
  useEffect(() => releaseToken('nudge_stop'), []);
  const [state, setState] = useState<NudgeStopState>(
    token === undefined || !hasBackend() ? 'no_token' : 'default',
  );
  const [reference, setReference] = useState<string | undefined>();

  const stop = () => {
    if (token === undefined || state === 'stopping') return;
    setReference(undefined);
    setState('stopping');
    stopNudges(token)
      .then(() => setState('done'))
      .catch((error: unknown) => {
        const failure = failureOf(error);
        if (failure.kind === 'reason' && failure.reason === 'link_expired') {
          setState('expired');
        } else if (failure.kind === 'offline') {
          setState('offline');
        } else {
          setReference(failure.reference);
          setState('error');
        }
      });
  };

  return <NudgeStopScreen state={state} reference={reference} onStop={stop} />;
}

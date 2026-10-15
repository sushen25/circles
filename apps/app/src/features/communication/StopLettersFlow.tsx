import type { StopFamily } from '@circles/contracts';
import { useEffect, useState } from 'react';

import { hasBackend } from '../../data/auth/client';
import { stopLetters } from '../../data/email';
import { heldToken, releaseToken, type TokenKind } from '../../data/links/tokens';
import { failureOf } from '../identity/join/failure';
import { StopLettersScreen, type StopLettersState } from './StopLettersScreen';

/** The token each page holds: one purpose per family, so a link works on its own page only. */
const HELD: Record<StopFamily, TokenKind> = {
  nudges: 'nudge_stop',
  organiser: 'organiser_stop',
  quiet: 'quiet_stop',
};

/**
 * `/n#<token>`, `/o#<token>` and `/q#<token>` — stop the cadence nudge, the
 * emails about plans you organise, or the emails about quiet asks, with no
 * sign-in (ADR 0067, ADR 0069, ADR 0023).
 *
 * The token is held for this screen alone and is posted only when the person
 * taps. Nothing is read on load: a page that stopped the letters as it opened
 * would let a mail gateway that fetches and runs links do it for them
 * (SUS-186). Nothing is tracked: no event carries the token or says whose it
 * is.
 */
export function StopLettersFlow({ family }: { family: StopFamily }) {
  const kind = HELD[family];
  const [token] = useState(() => heldToken(kind));
  // Taken for this screen alone: the held copy goes (ADR 0023).
  useEffect(() => releaseToken(kind), [kind]);
  const [state, setState] = useState<StopLettersState>(
    token === undefined || !hasBackend() ? 'no_token' : 'default',
  );
  const [reference, setReference] = useState<string | undefined>();

  const stop = () => {
    if (token === undefined || state === 'stopping') return;
    setReference(undefined);
    setState('stopping');
    stopLetters(family, token)
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

  return <StopLettersScreen family={family} state={state} reference={reference} onStop={stop} />;
}

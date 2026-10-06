import { useCallback, useState } from 'react';

import type { CodeStart } from '../identity/SavePlaceByEmail';

/**
 * Where the one-step card on Sent has got to (SUS-162): the card, the code,
 * then one of two ends. It lives above the screens it drives because signing in
 * can change the person's user id, which reloads the plan under a new key and
 * unmounts the screen that started it. What the person typed, the switch, and
 * how far they have got must survive that.
 */
export type OneStepStage =
  | { kind: 'card' }
  | { kind: 'code'; start: CodeStart; planId: string }
  /** The place is saved and this plan's emails are on, for `address`. */
  | { kind: 'done'; address: string }
  /** The place is saved; the emails could not be turned on. */
  | { kind: 'partial'; address: string };

export interface OneStep {
  stage: OneStepStage;
  email: string;
  setEmail: (email: string) => void;
  /** The "Save my place" switch: on by default, and no pre-ticked box anywhere else. */
  save: boolean;
  setSave: (save: boolean) => void;
  toCode: (start: CodeStart, planId: string) => void;
  toDone: (address: string) => void;
  toPartial: (address: string) => void;
  toCard: () => void;
}

export function useOneStep(initial: OneStepStage = { kind: 'card' }): OneStep {
  const [stage, setStage] = useState<OneStepStage>(initial);
  const [email, setEmail] = useState('');
  const [save, setSave] = useState(true);
  return {
    stage,
    email,
    setEmail,
    save,
    setSave,
    toCode: useCallback((start, planId) => setStage({ kind: 'code', start, planId }), []),
    toDone: useCallback((address) => setStage({ kind: 'done', address }), []),
    toPartial: useCallback((address) => {
      // The card comes back for the emails alone, with the address already in it.
      setEmail(address);
      setStage({ kind: 'partial', address });
    }, []),
    toCard: useCallback(() => setStage({ kind: 'card' }), []),
  };
}

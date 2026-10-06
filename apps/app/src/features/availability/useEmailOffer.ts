import type { PlanId } from '@circles/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { requestLinkCode } from '../../data/auth';
import type { AnswerablePlan } from '../../data/availability';
import {
  canReloadCopy,
  normaliseAddress,
  rememberTypedAddress,
  reloadCopy,
  requestEmailUpdates,
} from '../../data/email';
import { newIdempotencyKey } from '../../data/functions';
import { authFailure } from '../identity/authFailure';
import { failureOf } from '../identity/join/failure';
import type { Nudge } from '../growth/useNudge';
import type { OneStep } from './oneStep';
import type { SentProblem } from './SentScreen';

let lastSentAt = 0;
/** When a code was asked for, and the attempt's id: never the same twice, even in one millisecond. */
function nextSentAt(): number {
  lastSentAt = Math.max(Date.now(), lastSentAt + 1);
  return lastSentAt;
}

/**
 * What the card's primary does (spec §5.8, SUS-162). Pressing it is the consent.
 *
 * - **The switch on:** ask for a sign-in code for the address, and hand over to
 *   the code step. Nothing is sent to the plan yet; `SentFlow` finishes it when
 *   the code is right.
 * - **Off, or the emails-only retry:** today's path. `request-email-updates`
 *   sends the verification link and Check your email follows (a retry for the
 *   address that was just confirmed goes straight to done: nothing is sent).
 *
 * A new idempotency key per tap: the same key would replay the first answer and
 * queue nothing.
 */
export function useEmailOffer({
  code,
  plan,
  userId,
  live,
  canSave,
  offer,
  one,
}: {
  code: string;
  plan: AnswerablePlan;
  userId: string | undefined;
  live: boolean;
  /** The switch is offered: a guest, and the card is not the emails-only retry. */
  canSave: boolean;
  offer: Nudge | undefined;
  one: OneStep;
}) {
  const router = useRouter();
  const [problem, setProblem] = useState<SentProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // Which tap is the live one: "Not now" ends it, so a slow answer that arrives
  // afterwards changes nothing on a card the person has dismissed.
  const attempt = useRef(0);
  // The busy guard is a ref, so a second Enter before the first answer is read is ignored.
  const sending = useRef(false);
  const cancel = () => {
    attempt.current += 1;
  };
  // Leaving Sent ends what was asked there: an answer that arrives later must not
  // open a code screen, or replace a newer attempt, from a card that is gone.
  useEffect(() => cancel, []);

  const send = async () => {
    if (problem === 'copy_changed') {
      reloadCopy();
      return;
    }
    const address = normaliseAddress(one.email);
    if (address === null) {
      setProblem('not_an_address');
      setReference(undefined);
      return;
    }
    const savePlace = canSave && one.save;
    const planId = plan.id as PlanId;
    if (!live) {
      // The gallery: no backend to ask. The code step is a screen to look at.
      if (savePlace) {
        one.toCode({ address, route: 'new_identity', sentAt: nextSentAt() }, plan.id);
        return;
      }
      rememberTypedAddress(userId ?? '', plan.id, address);
      router.push({ pathname: '/j/[code]/check-email', params: { code } });
      return;
    }
    if (sending.current) return;
    sending.current = true;
    attempt.current += 1;
    const mine = attempt.current;
    setBusy(true);
    setProblem(undefined);
    setReference(undefined);
    try {
      if (savePlace) {
        const route = await requestLinkCode(address);
        if (attempt.current !== mine) return;
        track('email_submitted', { plan_id: planId, save_place: true });
        one.toCode({ address, route, sentAt: nextSentAt() }, plan.id);
        return;
      }
      await requestEmailUpdates({
        planId: plan.id,
        email: address,
        idempotencyKey: newIdempotencyKey(),
      });
      track('email_submitted', { plan_id: planId, save_place: false });
      if (attempt.current !== mine) return;
      offer?.tap();
      if (one.stage.kind === 'partial' && one.stage.address === address) {
        // The confirmed address is its own proof: the emails are on, nothing was sent.
        one.toDone(address);
        return;
      }
      rememberTypedAddress(userId ?? '', plan.id, address);
      // The card stays, address and all: "Use a different one" on Check your
      // email comes back here, and there must be somewhere to type it.
      router.push({ pathname: '/j/[code]/check-email', params: { code } });
    } catch (error) {
      if (savePlace) {
        const failure = authFailure(error);
        setProblem(
          failure === 'offline'
            ? 'offline'
            : failure === 'too_many'
              ? 'too_many_tries'
              : 'couldnt_send',
        );
        return;
      }
      const failure = failureOf(error);
      if (failure.kind === 'offline') setProblem('offline');
      else if (failure.kind === 'reason' && failure.reason === 'too_many_requests') {
        setProblem('too_many_tries');
      } else if (failure.kind === 'reason' && failure.reason === 'consent_version_unknown') {
        // The wording on screen is not one the server ever showed anybody.
        // Nothing was recorded. Say so; the next tap loads the current copy (a
        // reload here, unprompted, would unload the page before the notice
        // could be read). A native build has no page to reload, so it says
        // plainly that it could not send, with the reference.
        if (canReloadCopy()) {
          setProblem('copy_changed');
        } else {
          setProblem('couldnt_send');
          setReference(failure.reference);
        }
      } else {
        setProblem('couldnt_send');
        setReference(failure.reference);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return { problem, reference, busy, send, cancel };
}

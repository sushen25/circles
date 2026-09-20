import type { IdempotencyKey, PlanId, ShortCode } from '@circles/contracts';
import type { PlanTiming, ResponseStatus } from '@circles/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import {
  clearDraft,
  onChanceToResend,
  submitAnswer,
  writeDraft,
  type AnswerablePlan,
  type Draft,
  type Span,
} from '../../data/availability';
import { FunctionError, newIdempotencyKey } from '../../data/functions';
import { askToPlan } from '../../data/membership';
import { failureOf, isOffline } from '../identity/join/failure';
import type { DayRow } from './days';
import { windowsOf, type EditorState } from './editor';

/**
 * Keeping an answer on the device and getting it to the server (spec §5.5,
 * ADR 0016).
 *
 * - **Every change is written to the device as it happens** — after the first
 *   edit, never on opening: a stored answer copied into a draft would look
 *   newer than the answer, and outrank an edit made later on another device.
 * - **One idempotency key per answer.** A resend of the same answer is the same
 *   request; a changed answer is a new one.
 * - **No answer from the server** means the times wait here and go when there
 *   is a chance: the connection coming back, the page coming back, and every
 *   thirty seconds. **A refusal** means a screen, decided here.
 */

export type Phase =
  | { kind: 'editing'; problem?: string }
  | { kind: 'sending'; status: ResponseStatus }
  | { kind: 'offline'; status: ResponseStatus }
  | { kind: 'error'; status: ResponseStatus; reference: string | undefined }
  | { kind: 'closed' };

type Pending = { status: ResponseStatus; key: IdempotencyKey; body: string };

/** What an answer *is*, for telling a resend from a changed answer. */
function bodyOf(status: ResponseStatus, windows: readonly Span[]): string {
  return JSON.stringify({ status, windows: status === 'windows' ? windows : [] });
}

/** A send that did not finish before the page went away: it goes again, as the same request. */
function resumeFrom(draft: Draft | undefined): Pending | undefined {
  if (draft?.pending === undefined) return undefined;
  const { status, idempotencyKey } = draft.pending;
  return { status, key: idempotencyKey, body: bodyOf(status, draft.windows) };
}

/** Resends while the times are waiting on the device, beyond `online` and focus. */
const RESEND_EVERY_MS = 30_000;

export type SendAnswerOptions = {
  code: string;
  plan: AnswerablePlan;
  /** Undefined with no backend: nothing is stored and nothing is sent. */
  userId: string | undefined;
  state: EditorState;
  rows: readonly DayRow[];
  timing: PlanTiming;
  /** The draft the editor opened from, when it did. */
  draft: Draft | undefined;
  onStale: () => void;
};

export function useSendAnswer({
  code,
  plan,
  userId,
  state,
  rows,
  timing,
  draft,
  onStale,
}: SendAnswerOptions) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [resumed] = useState(() => resumeFrom(draft));
  const pending = useRef<Pending | undefined>(resumed);
  const [phase, setPhase] = useState<Phase>(
    resumed === undefined ? { kind: 'editing' } : { kind: 'offline', status: resumed.status },
  );
  const [savedAt, setSavedAt] = useState<string | undefined>(draft?.savedAt);

  // Written when the answer changes, and only then: ticking a day or opening
  // one to adjust is how the screen looks, not what the person said, and it
  // is never stored (ADR 0024). The reducer keeps `days` the same array
  // through those, so they do not reach this effect.
  const { days, flexible } = state;
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current || userId === undefined) return;
    void writeDraft(userId, code, {
      plan,
      windows: windowsOf({ days }, rows, timing),
      flexible,
      ...(pending.current === undefined
        ? {}
        : { pending: { status: pending.current.status, idempotencyKey: pending.current.key } }),
    });
  }, [days, flexible, userId, code, plan, rows, timing]);

  /** The person changed their answer; call before dispatching it. */
  const edited = () => {
    touched.current = true;
    setSavedAt(new Date().toISOString());
  };

  // Straight away, when there is a reason to think it will go now: the page has
  // just come back with a send it did not finish, or the plan has just agreed
  // to ask this person.
  const [resendNow, setResendNow] = useState(resumed === undefined ? 0 : 1);
  const sendingRef = useRef(false);
  /** Asked the plan to include them once for this answer; a second refusal is real. */
  const askedOnce = useRef(false);

  const send = useCallback(
    async (status: ResponseStatus): Promise<void> => {
      if (sendingRef.current) return;
      const windows = status === 'windows' ? windowsOf(state, rows, timing) : [];
      const body = bodyOf(status, windows);
      if (pending.current?.body !== body) {
        pending.current = { status, key: newIdempotencyKey(), body };
      }
      const { key } = pending.current;

      if (userId === undefined) {
        // No backend: the gallery's plan, and nowhere to send it.
        router.replace({ pathname: '/j/[code]/sent', params: { code } });
        return;
      }

      sendingRef.current = true;
      setPhase({ kind: 'sending', status });
      const now = new Date();
      await writeDraft(
        userId,
        code,
        {
          plan,
          windows: windowsOf(state, rows, timing),
          flexible: state.flexible,
          pending: { status, idempotencyKey: key },
        },
        now,
      );
      setSavedAt(now.toISOString());

      let refusal: unknown;
      try {
        await submitAnswer({
          planId: plan.id,
          revision: plan.revision,
          status,
          windows,
          idempotencyKey: key,
        });
      } catch (error) {
        refusal = error ?? new Error('submit failed');
      }
      sendingRef.current = false;

      if (refusal === undefined) {
        pending.current = undefined;
        await clearDraft(userId, code);
        track('availability_submitted', {
          plan_id: plan.id as PlanId,
          status,
          window_count: windows.length,
        });
        void queryClient.invalidateQueries({ queryKey: ['plan-to-answer', code] });
        router.replace({ pathname: '/j/[code]/sent', params: { code } });
        return;
      }

      // No answer at all: the times wait here and go when they can.
      if (isOffline() || (refusal instanceof FunctionError && refusal.problem === undefined)) {
        setPhase({ kind: 'offline', status });
        return;
      }
      const failure = failureOf(refusal);
      const reason = failure.kind === 'reason' ? failure.reason : undefined;
      const reference = failure.kind === 'offline' ? undefined : failure.reference;

      switch (reason) {
        case 'stale_revision':
          // The question changed under the answer. Ask the new one; the old
          // times are for dates that may not be in it.
          pending.current = undefined;
          await clearDraft(userId, code);
          // Out of `sending` here, not only by the caller's remount: until the
          // new question arrives this screen must not sit locked.
          setPhase({ kind: 'editing' });
          onStale();
          return;
        case 'replies_closed':
          pending.current = undefined;
          await clearDraft(userId, code);
          setPhase({ kind: 'closed' });
          return;
        case 'not_a_participant': {
          // Joined after the plan was made, and the gate's ask has not landed
          // (ADR 0022): ask now, then send the same answer again. The refusal
          // released the key, so the resend is the same request.
          if (askedOnce.current) break;
          askedOnce.current = true;
          const outcome = await askToPlan(code as ShortCode);
          if (outcome === 'closed') {
            setPhase({ kind: 'closed' });
            return;
          }
          // Could not ask (offline, or out of retries): the next resend asks
          // again rather than meeting the same refusal as a dead end.
          if (outcome === 'failed') askedOnce.current = false;
          setPhase({ kind: 'offline', status });
          if (outcome === 'asked') setResendNow((n) => n + 1);
          return;
        }
        case 'in_progress':
          // The first send is still going through. It will answer the resend.
          setPhase({ kind: 'offline', status });
          return;
        case 'too_many_requests':
          setPhase({ kind: 'editing', problem: t('availability', 'too_many_tries') });
          return;
        default:
          break;
      }
      setPhase({ kind: 'error', status, reference });
    },
    [state, rows, timing, userId, code, plan, router, queryClient, onStale],
  );

  const waiting = phase.kind === 'offline' ? phase.status : undefined;
  useEffect(() => {
    if (waiting === undefined) return;
    const retry = () => void send(waiting);
    const stop = onChanceToResend(retry);
    const timer = setInterval(retry, RESEND_EVERY_MS);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [waiting, send]);

  useEffect(() => {
    if (resendNow === 0 || waiting === undefined) return;
    // Next tick, not in the effect itself: sending updates the screen.
    const soon = setTimeout(() => void send(waiting), 0);
    return () => clearTimeout(soon);
    // Only when `resendNow` moves; `send` changing with every paint is not a
    // reason to send again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resendNow]);

  return { phase, send, savedAt, edited };
}

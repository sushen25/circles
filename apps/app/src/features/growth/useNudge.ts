import type { IdempotencyKey } from '@circles/contracts';
import {
  instant,
  nudgeEligibility,
  spendsSessionBudget,
  type IdentityTier,
  type NudgeMoment,
} from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useSession, type SessionStatus } from '../../data/auth/session';
import { askToShow, recordAnswer, type NudgeTarget } from '../../data/growth';
import { newIdempotencyKey } from '../../data/functions';

/**
 * One conversion prompt: whether to show it, and what to do when it is
 * answered (spec §5.11, S2-07).
 *
 * Three sources, in the order they are asked:
 *
 * 1. **This session.** At most one prompt per session, which the server
 *    cannot know — it has no sessions. Kept in this module, so a reload is a
 *    new session, as it is for the person.
 * 2. **The domain rule, over what is known here** — who this is and whether
 *    the session has been spent. A prompt that could never be shown is not
 *    asked about.
 * 3. **`record-nudge`**, which runs the same rule over every device's history
 *    and records a yes as shown before giving it.
 *
 * While the question is out the answer is `pending`, and a screen shows its
 * neutral state rather than a prompt that might then vanish. A failure is
 * `skip` — no prompt is better than a prompt twice — unless the caller says
 * the prompt is part of the core loop (`failOpen`, the email card).
 */
export type NudgeShowing = 'pending' | 'show' | 'skip';

export interface Nudge {
  /** Unchanged by an answer: a screen that follows a tap is still the prompt's. */
  showing: NudgeShowing;
  /** What was done with it on this screen, if anything. */
  answered: 'dismissed' | 'tapped' | undefined;
  /** "Not now", "Maybe later", "Carry on". */
  dismiss: () => void;
  /** The prompt's own action was taken. */
  tap: () => void;
}

export interface NudgeOptions {
  planId?: string | undefined;
  /** Not the moment yet: nothing is asked and the prompt is skipped. */
  enabled?: boolean | undefined;
  /** Show the prompt if the server cannot be asked. Only for the email card. */
  failOpen?: boolean | undefined;
}

/**
 * The prompt that spent this session's one, and the key each question went
 * out under. The key is kept so that a screen mounted again asks the same
 * question and is given the same answer (ADR 0016) rather than being told its
 * own prompt has been shown already.
 */
let spentBy: string | undefined;
const keys = new Map<string, IdempotencyKey>();
/**
 * Prompts answered in this session. An answer is final: the screen that asked
 * mounted again — Back, then forward — is not asked again, though a prompt
 * left without an answer is still the same prompt and is shown again.
 */
const answeredHere = new Set<string>();

/** For tests: a new session. */
export function forgetSessionNudges(): void {
  spentBy = undefined;
  keys.clear();
  answeredHere.clear();
}

function tierOf(status: SessionStatus): IdentityTier | undefined {
  switch (status) {
    case 'guest':
      return 'guest';
    case 'saved':
      return 'saved';
    case 'app':
      return 'app';
    case 'none':
      return undefined;
  }
}

function keyFor(id: string): IdempotencyKey {
  let key = keys.get(id);
  if (key === undefined) {
    key = newIdempotencyKey();
    keys.set(id, key);
  }
  return key;
}

export function useNudge(moment: NudgeMoment, options: NudgeOptions = {}): Nudge {
  const session = useSession();
  const { planId, enabled = true, failOpen = false } = options;
  const target: NudgeTarget = { moment, planId };
  const id = `${session.userId ?? ''}:${moment}:${planId ?? ''}`;
  const tier = tierOf(session.status);

  // Read once per mount: a rule over "now" must not change its mind on a
  // re-render.
  const [openedAt] = useState(() => instant(Date.now()));
  const local =
    tier === undefined
      ? ({ kind: 'skip' } as const)
      : nudgeEligibility(moment, [], tier, openedAt, {
          planId,
          shownThisSession: spentBy !== undefined && spentBy !== id,
        });
  const ask = enabled && !session.isLoading && local.kind === 'show';

  const question = useQuery({
    queryKey: ['nudge', id],
    queryFn: async () => {
      const answer = await askToShow(target, keyFor(id));
      if (!answer.suppressed && spendsSessionBudget(moment)) spentBy = id;
      return answer;
    },
    enabled: ask,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  const [answered, setAnswered] = useState<'dismissed' | 'tapped' | undefined>();
  const answer = useCallback(
    (what: 'dismissed' | 'tapped') => {
      answeredHere.add(id);
      setAnswered(what);
      // Recorded in the background: the person has moved on, and a failure
      // here costs the back-off one data point, not the screen they are on.
      void recordAnswer({ moment, planId }, what, newIdempotencyKey()).catch(() => undefined);
    },
    [id, moment, planId],
  );

  let showing: NudgeShowing;
  // Answered on an earlier mount, in this session. This mount's own answer
  // does not count: the prompt it is still drawing is not turned into a skip.
  if (!ask || (answered === undefined && answeredHere.has(id))) showing = 'skip';
  else if (question.isPending) showing = 'pending';
  else if (question.isError) showing = failOpen ? 'show' : 'skip';
  else showing = question.data.suppressed ? 'skip' : 'show';

  return {
    showing,
    answered,
    dismiss: () => answer('dismissed'),
    tap: () => answer('tapped'),
  };
}

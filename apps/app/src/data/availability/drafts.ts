import { IdempotencyKey } from '@circles/contracts';
import { z } from 'zod';

import { sessionStorage } from '../auth/storage';
import type { AnswerablePlan, Span } from './plan';

/**
 * An answer that has not reached the server yet, kept on this device (spec §5.5:
 * "drafts survive going offline and resubmit"; §10: edits "survive refresh").
 *
 * **What it holds.** What is painted, whether "I'm easy" is on, and a snapshot
 * of the question — so that somebody who painted their times on a train and
 * reloaded in a tunnel still sees the dates they were answering, not an error
 * page. And, once they have pressed send, the send itself: the status and the
 * idempotency key, so that the resend on reconnect *is* that send (ADR 0016)
 * and not a second answer.
 *
 * **Keyed by person and plan.** A shared browser is a real case here — a family
 * iPad — and the next person to open the link must not see, or send, somebody
 * else's times. The revision lives inside the draft rather than in the key, so
 * a draft for a question the organiser has since changed is *found* and can be
 * reported, rather than silently orphaned (the rescheduled state).
 *
 * **Where.** The same storage the session uses (`../auth/storage`): localStorage
 * on the web, mirrored in memory for the tab when the browser refuses it, and
 * the chunked secure store on native. A draft is not a secret, but it is
 * somebody's week, and one adapter with the platform rules already worked out
 * beats a second one that has to learn them.
 */

const Span = z.object({ start: z.string(), end: z.string() });

const Draft = z.object({
  v: z.literal(1),
  plan: z.object({
    id: z.string(),
    code: z.string(),
    circleId: z.string(),
    circleName: z.string(),
    title: z.string(),
    category: z.enum(['catch_up', 'dinner', 'drinks', 'coffee', 'activity']),
    state: z.enum([
      'draft',
      'seeking',
      'collecting',
      'ready',
      'confirmed',
      'completed',
      'expired',
      'cancelled',
    ]),
    revision: z.int().positive(),
    zone: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
    dailyStartMin: z.int(),
    dailyEndMin: z.int(),
    durationMinutes: z.union([z.literal(60), z.literal(90), z.literal(120), z.literal(180)]),
    responseDeadline: z.string(),
    organiserName: z.string().nullable(),
    acceptingAnswers: z.boolean(),
  }),
  windows: z.array(Span),
  flexible: z.boolean(),
  savedAt: z.string(),
  /** A send that has not been answered. Present means "resend me". */
  pending: z
    .object({
      status: z.enum(['windows', 'flexible', 'none_work', 'more_notice', 'not_this_time']),
      idempotencyKey: IdempotencyKey,
    })
    .optional(),
});
export type Draft = z.infer<typeof Draft>;

export type DraftInput = {
  plan: AnswerablePlan;
  windows: readonly Span[];
  flexible: boolean;
  pending?: Draft['pending'];
};

const PREFIX = 'circles.answer-draft.';

function keyFor(userId: string, code: string): string {
  return `${PREFIX}${userId}.${code}`;
}

/** The draft for this person and plan, whatever revision it answered. */
export async function readDraft(userId: string, code: string): Promise<Draft | undefined> {
  let raw: string | null | undefined;
  try {
    raw = await sessionStorage.getItem(keyFor(userId, code));
  } catch {
    return undefined;
  }
  if (raw === null || raw === undefined) return undefined;

  try {
    const parsed = Draft.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON: fall through to discarding it.
  }
  // Something this version cannot read — an older shape, or a torn write. It
  // can only ever be shown wrongly, so it goes.
  await clearDraft(userId, code);
  return undefined;
}

export async function writeDraft(
  userId: string,
  code: string,
  draft: DraftInput,
  now: Date = new Date(),
): Promise<void> {
  const stored: Draft = {
    v: 1,
    plan: draft.plan,
    windows: [...draft.windows],
    flexible: draft.flexible,
    savedAt: now.toISOString(),
    ...(draft.pending === undefined ? {} : { pending: draft.pending }),
  };
  try {
    await sessionStorage.setItem(keyFor(userId, code), JSON.stringify(stored));
  } catch {
    // Storage refusing costs durability across a reload, not the answer in
    // front of the person, which is still in memory.
  }
}

export async function clearDraft(userId: string, code: string): Promise<void> {
  try {
    await sessionStorage.removeItem(keyFor(userId, code));
  } catch {
    // Already unreachable.
  }
}

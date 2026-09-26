import { IdempotencyKey } from '@circles/contracts';
import { AppState } from 'react-native';
import { z } from 'zod';

import { draftStore } from './draftStore';
import type { DraftStore } from './draftStorePort';
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
 * **Where.** Its own storage port (`draftStorePort.ts`): `localStorage` on the
 * web, through the session's adapter there, and MMKV in the app (S3-01a). It
 * used to be the session's store on both, which on native is the chunked
 * secure store — every paint an encrypted multi-chunk write, and every clear
 * the session's sign-out erase (S1-25's note on SUS-57).
 *
 * **When.** A paint is a burst: a drag is a write per cell. `saveDraftSoon`
 * holds the burst for the store's `coalesceMs` and writes the last state once;
 * `writeDraft` writes now, and is what a send uses, so the send never waits on
 * a queue of stale paints and the draft it leaves is the one it sent. Held
 * writes are flushed when the app leaves the foreground, and a read or a clear
 * sees them first, so nothing can read a draft older than the one on screen.
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
    durationMinutes: z.union([
      z.literal(60),
      z.literal(90),
      z.literal(120),
      z.literal(180),
      z.literal(240),
      z.literal(300),
    ]),
    responseDeadline: z.string(),
    organiserName: z.string().nullable(),
    // Optional: a draft written before this field existed is still a draft
    // somebody's times are in, and refusing it would throw those away.
    organiserUserId: z.string().nullable().default(null),
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

/** Writes held back by `saveDraftSoon`, by key, with the timer that will write them. */
const held = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>();
let store: DraftStore = draftStore;
let watchingAppState = false;

/** Tests only: a store to write to, and a clean slate. */
export function setDraftStoreForTests(next: DraftStore = draftStore): void {
  for (const { timer } of held.values()) clearTimeout(timer);
  held.clear();
  store = next;
}

function put(key: string, value: string): void {
  const pending = held.get(key);
  if (pending !== undefined) {
    clearTimeout(pending.timer);
    held.delete(key);
  }
  try {
    store.set(key, value);
  } catch {
    // Storage refusing costs durability across a reload, not the answer in
    // front of the person, which is still in memory.
  }
}

/** Every held write, now. */
export function flushDrafts(): void {
  for (const [key, { value }] of [...held]) put(key, value);
}

function watchAppState(): void {
  if (watchingAppState) return;
  watchingAppState = true;
  // Backgrounded is the last moment a write is certain to happen: the system
  // may end the process from there without another line of JavaScript.
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') flushDrafts();
  });
}

function stored(draft: DraftInput, now: Date): string {
  const value: Draft = {
    v: 1,
    plan: draft.plan,
    windows: [...draft.windows],
    flexible: draft.flexible,
    savedAt: now.toISOString(),
    ...(draft.pending === undefined ? {} : { pending: draft.pending }),
  };
  return JSON.stringify(value);
}

/** The draft for this person and plan, whatever revision it answered. */
export async function readDraft(userId: string, code: string): Promise<Draft | undefined> {
  const key = keyFor(userId, code);
  let raw: string | null | undefined = held.get(key)?.value;
  if (raw === undefined) {
    try {
      raw = store.get(key);
    } catch {
      return undefined;
    }
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

/** Written now, replacing anything held for the same draft. What a send uses. */
export async function writeDraft(
  userId: string,
  code: string,
  draft: DraftInput,
  now: Date = new Date(),
): Promise<void> {
  put(keyFor(userId, code), stored(draft, now));
}

/**
 * Written once the painting pauses: the last state of a burst, once. On a
 * store that does not coalesce (the web's), the same as `writeDraft`.
 */
export function saveDraftSoon(
  userId: string,
  code: string,
  draft: DraftInput,
  now: Date = new Date(),
): void {
  const key = keyFor(userId, code);
  const value = stored(draft, now);
  if (store.coalesceMs <= 0) {
    put(key, value);
    return;
  }
  watchAppState();
  const pending = held.get(key);
  if (pending !== undefined) clearTimeout(pending.timer);
  held.set(key, { value, timer: setTimeout(() => put(key, value), store.coalesceMs) });
}

/** This draft's key, and nothing else's. A held write for it is dropped first. */
export async function clearDraft(userId: string, code: string): Promise<void> {
  const key = keyFor(userId, code);
  const pending = held.get(key);
  if (pending !== undefined) {
    clearTimeout(pending.timer);
    held.delete(key);
  }
  try {
    store.remove(key);
  } catch {
    // Already unreachable.
  }
}

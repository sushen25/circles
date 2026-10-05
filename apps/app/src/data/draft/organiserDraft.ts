import { IdempotencyKey } from '@circles/contracts';
import { DURATIONS, type DurationMinutes } from '@circles/domain';
import { z } from 'zod';

import { sessionStorage } from '../auth/storage';
import { newIdempotencyKey } from '../functions';

/**
 * The circle and the plan an organiser has drafted before there is an account
 * to own them (spec §5.1, ADR 0053).
 *
 * **Nothing here is on a server.** `create-circle` and `create-plan` run once
 * the place is saved and the organiser has a name, so a person who walks away
 * at the gate leaves nothing in the database. ADR 0004's invariant — organiser
 * roles belong to saved-place identities only — is about what exists, and
 * nothing exists yet.
 *
 * **One record, on this device.** The session's own storage adapter
 * (`../auth/storage`): `localStorage` on the web, the chunked secure store on
 * native. It is written as the organiser goes, so it survives a reload and the
 * round trip to an email code or an OAuth provider, and it is read fresh by
 * every screen that needs it.
 *
 * **Twenty-four hours after the last change, it is gone.** A read past that
 * removes the record and says there is none. Sliding rather than fixed: a
 * person who comes back at hour twenty-three and edits has not abandoned it.
 *
 * **The whole plan setup travels with it** (`plan`): what the organiser chose on
 * the First plan card and on the plan setup in its draft mode — the kind, the
 * window, the hours, the length and the reply deadline. The finish makes the
 * plan from exactly this. It has no quorum and no required people: a circle of
 * one has nobody to count, so the quorum stays the server's own (ADR 0026).
 *
 * **The idempotency keys travel with it** (ADR 0016). A finish interrupted
 * after the circle was made runs again with the same keys and gets the same
 * circle and the same plan, not a second of each. A key is only good for the
 * request it was made for, so a change to what the request says makes a new one.
 *
 * SUS-92 adds an MMKV store for answers; this record moves into it when that
 * reaches `main`. Four functions in this file are the whole interface, and
 * every one of them takes its turn in a single line (`inLine`), so a slow
 * adapter cannot interleave two of them.
 */
export const DRAFT_KEY = 'circles.organiser-draft';
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export const DRAFT_CADENCES = ['weekly', 'fortnightly', 'monthly', 'two_monthly', 'none'] as const;
/** The window presets of the plan setup (spec §5.3). */
export const DRAFT_PRESETS = [
  'tonight',
  'this_weekend',
  'next_7_days',
  'next_14_days',
  'custom',
] as const;
export const DRAFT_CATEGORIES = ['catch_up', 'dinner', 'drinks', 'coffee', 'activity'] as const;
/** What happens once the place is saved: ask the group, or just invite people. */
export const DRAFT_WAYS = ['ask', 'invite'] as const;

const DraftPlan = z.object({
  category: z.enum(DRAFT_CATEGORIES),
  preset: z.enum(DRAFT_PRESETS),
  /** Inclusive local dates, with the days asked about when there are gaps (ADR 0047). */
  custom: z
    .object({
      start: z.string().max(10),
      end: z.string().max(10),
      days: z.array(z.string().max(10)).max(120).optional(),
    })
    .optional(),
  /** An explicit daily band; absent, the window's own suggestion. */
  band: z.object({ startMin: z.number().int(), endMin: z.number().int() }).optional(),
  duration: z.custom<DurationMinutes>(
    (value) => typeof value === 'number' && (DURATIONS as readonly number[]).includes(value),
  ),
  /** ISO. Absent, the preset's default deadline. */
  deadline: z.string().max(40).optional(),
});

/**
 * The shape of the stored record. **Version 2** holds the whole plan setup;
 * version 1 held only a preset. A record of another version does not parse and
 * is read as "no draft", never crashed on.
 */
const Draft = z.object({
  v: z.literal(2),
  /** Epoch milliseconds of the last change: the 24 hours run from here. */
  updatedAt: z.number().int(),
  circleName: z.string().max(80),
  cadence: z.enum(DRAFT_CADENCES),
  plan: DraftPlan,
  /** Set when Ask the group or Just invite people was chosen. */
  way: z.enum(DRAFT_WAYS).optional(),
  /**
   * The organiser is signed in, or has just been: Your name and the finish
   * may carry on. A stale draft that somebody signs in beside — the quiet "Sign
   * in" of a returning organiser — never has it, and is never made into a circle.
   */
  proceed: z.boolean(),
  /**
   * `circle_created` has been counted for the circle these keys make. A finish
   * that runs again returns the same circle, and must not count it again.
   */
  circleCounted: z.boolean().default(false),
  keys: z.object({ circle: IdempotencyKey, plan: IdempotencyKey }),
});

export type OrganiserDraft = z.infer<typeof Draft>;
export type DraftCadence = (typeof DRAFT_CADENCES)[number];
export type DraftPreset = (typeof DRAFT_PRESETS)[number];
export type DraftPlan = z.infer<typeof DraftPlan>;
export type DraftWay = (typeof DRAFT_WAYS)[number];

/** What a change may carry. `way` and `proceed` are set by the screens that choose them. */
export type DraftPatch = Partial<
  Pick<OrganiserDraft, 'circleName' | 'cadence' | 'plan' | 'way' | 'proceed' | 'circleCounted'>
>;

/**
 * What the device refused to keep. The web adapter mirrors in memory itself;
 * native secure storage does not, and a write it rejects would otherwise read
 * back as "no draft" on the very next screen and send the person back to the
 * start. While the last write failed, this copy is the draft for this run of
 * the app.
 */
let refused: string | null = null;

/**
 * A deletion the device refused. The record is still on disk, and without this
 * the next read would find it: after a sign-out, somebody else's circle name;
 * after a finish, a draft already used. While it is set the draft is "none", and
 * the removal is tried again on each read until it takes.
 */
let cleared = false;

/**
 * The line every touch of the record waits in. Native storage is asynchronous,
 * so `saveDraft` (read, merge, write) and `clearDraft` could otherwise
 * interleave: two quick saves would each merge into the same old record and the
 * later write would drop the earlier one's fields, and a save already in flight
 * would land after a clear and bring a finished or signed-out draft back. Run
 * one at a time, in the order they were called, a clear stays the last word on
 * everything called before it, and a save called after it starts a fresh draft.
 * A failed turn never stops the line.
 */
let line: Promise<unknown> = Promise.resolve();

function inLine<T>(turn: () => Promise<T>): Promise<T> {
  const result = line.then(turn, turn);
  line = result.catch(() => undefined);
  return result;
}

/** What the plan is before anything is chosen: the fortnight, two hours, the defaults. */
export const DEFAULT_PLAN: DraftPlan = {
  category: 'catch_up',
  preset: 'next_14_days',
  duration: 120,
};

/** The same plan, whatever order the keys came in: a request is the same request. */
function planKey(plan: DraftPlan): string {
  return JSON.stringify([
    plan.category,
    plan.preset,
    plan.custom?.start,
    plan.custom?.end,
    plan.custom?.days,
    plan.band?.startMin,
    plan.band?.endMin,
    plan.duration,
    plan.deadline,
  ]);
}

export function samePlan(a: DraftPlan, b: DraftPlan): boolean {
  return planKey(a) === planKey(b);
}

function blank(now: number): OrganiserDraft {
  return {
    v: 2,
    updatedAt: now,
    circleName: '',
    cadence: 'monthly',
    plan: DEFAULT_PLAN,
    proceed: false,
    circleCounted: false,
    keys: { circle: newIdempotencyKey(), plan: newIdempotencyKey() },
  };
}

/** The draft, or `null` when there is none, it has expired, or it cannot be read. */
export function readDraft(now: number = Date.now()): Promise<OrganiserDraft | null> {
  return inLine(() => read(now));
}

async function read(now: number): Promise<OrganiserDraft | null> {
  if (cleared) {
    await remove();
    if (cleared) return null;
  }
  let raw: string | null;
  try {
    raw = await sessionStorage.getItem(DRAFT_KEY);
  } catch {
    raw = null;
  }
  if (refused !== null) raw = refused;
  if (raw === null) return null;
  let draft: OrganiserDraft | undefined;
  try {
    const parsed = Draft.safeParse(JSON.parse(raw));
    draft = parsed.success ? parsed.data : undefined;
  } catch {
    draft = undefined;
  }
  // Unreadable, or older than a day: removed, so nothing keeps answering for it.
  if (draft === undefined || now - draft.updatedAt >= DRAFT_TTL_MS) {
    await remove();
    return null;
  }
  return draft;
}

/**
 * Applies a change and writes it. `created` is true for the write that made the
 * draft, which is what `organiser_draft_started` is counted on.
 */
export function saveDraft(
  patch: DraftPatch,
  now: number = Date.now(),
): Promise<{ draft: OrganiserDraft; created: boolean }> {
  return inLine(() => write(patch, now));
}

async function write(
  patch: DraftPatch,
  now: number,
): Promise<{ draft: OrganiserDraft; created: boolean }> {
  const before = await read(now);
  const base = before ?? blank(now);
  const next: OrganiserDraft = { ...base, ...patch, updatedAt: now };
  // A different circle is a different request, and a different plan too, since
  // the plan is made in that circle; a different setup is a different plan.
  const circleChanged = next.circleName !== base.circleName || next.cadence !== base.cadence;
  const planChanged = !samePlan(next.plan, base.plan);
  if (circleChanged) {
    next.keys = { circle: newIdempotencyKey(), plan: newIdempotencyKey() };
    next.circleCounted = false;
  } else if (planChanged) next.keys = { ...next.keys, plan: newIdempotencyKey() };
  const raw = JSON.stringify(next);
  cleared = false;
  try {
    await sessionStorage.setItem(DRAFT_KEY, raw);
    refused = null;
  } catch {
    // The device would not keep it. The flow goes on from memory; a reload then
    // starts again, which is the cost of a refused write.
    refused = raw;
  }
  return { draft: next, created: before === null };
}

export function clearDraft(): Promise<void> {
  return inLine(remove);
}

async function remove(): Promise<void> {
  refused = null;
  try {
    await sessionStorage.removeItem(DRAFT_KEY);
    cleared = false;
  } catch {
    cleared = true;
  }
}

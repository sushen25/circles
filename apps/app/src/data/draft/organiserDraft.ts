import { IdempotencyKey } from '@circles/contracts';
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
 * **The idempotency keys travel with it** (ADR 0016). A finish interrupted
 * after the circle was made runs again with the same keys and gets the same
 * circle and the same plan, not a second of each. A key is only good for the
 * request it was made for, so a change to what the request says makes a new one.
 *
 * SUS-92 adds an MMKV store for answers; this record moves into it when that
 * reaches `main`. Four functions in this file are the whole interface.
 */
export const DRAFT_KEY = 'circles.organiser-draft';
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export const DRAFT_CADENCES = ['weekly', 'fortnightly', 'monthly', 'two_monthly', 'none'] as const;
export const DRAFT_PRESETS = ['next_14_days', 'this_weekend', 'tonight'] as const;
/** What happens once the place is saved: ask the group, or just invite people. */
export const DRAFT_WAYS = ['ask', 'invite'] as const;

const Draft = z.object({
  v: z.literal(1),
  /** Epoch milliseconds of the last change: the 24 hours run from here. */
  updatedAt: z.number().int(),
  circleName: z.string().max(80),
  cadence: z.enum(DRAFT_CADENCES),
  preset: z.enum(DRAFT_PRESETS),
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
export type DraftWay = (typeof DRAFT_WAYS)[number];

/** What a change may carry. `way` and `proceed` are set by the screens that choose them. */
export type DraftPatch = Partial<
  Pick<OrganiserDraft, 'circleName' | 'cadence' | 'preset' | 'way' | 'proceed' | 'circleCounted'>
>;

function blank(now: number): OrganiserDraft {
  return {
    v: 1,
    updatedAt: now,
    circleName: '',
    cadence: 'monthly',
    preset: 'next_14_days',
    proceed: false,
    circleCounted: false,
    keys: { circle: newIdempotencyKey(), plan: newIdempotencyKey() },
  };
}

/** The draft, or `null` when there is none, it has expired, or it cannot be read. */
export async function readDraft(now: number = Date.now()): Promise<OrganiserDraft | null> {
  let raw: string | null;
  try {
    raw = await sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
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
    await clearDraft();
    return null;
  }
  return draft;
}

/**
 * Applies a change and writes it. `created` is true for the write that made the
 * draft, which is what `organiser_draft_started` is counted on.
 */
export async function saveDraft(
  patch: DraftPatch,
  now: number = Date.now(),
): Promise<{ draft: OrganiserDraft; created: boolean }> {
  const before = await readDraft(now);
  const base = before ?? blank(now);
  const next: OrganiserDraft = { ...base, ...patch, updatedAt: now };
  // A different circle is a different request, and a different plan too, since
  // the plan is made in that circle; a different preset is a different plan.
  const circleChanged = next.circleName !== base.circleName || next.cadence !== base.cadence;
  const planChanged = next.preset !== base.preset;
  if (circleChanged) {
    next.keys = { circle: newIdempotencyKey(), plan: newIdempotencyKey() };
    next.circleCounted = false;
  } else if (planChanged) next.keys = { ...next.keys, plan: newIdempotencyKey() };
  try {
    await sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch {
    // The browser would not keep it. The flow goes on with what is in memory;
    // a reload then starts again, which is the cost of a refused write.
  }
  return { draft: next, created: before === null };
}

export async function clearDraft(): Promise<void> {
  try {
    await sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Already unreachable.
  }
}

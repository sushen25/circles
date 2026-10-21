import { parseSourceRef } from '@circles/domain';
import { z } from 'zod';

import { sessionStorage } from '../auth/storage';

/**
 * The campaign tag a visitor arrived on (`?from=<tag>`, SUS-240), kept on this
 * device until the organiser has passed the gate and the circle is made.
 *
 * It is a label for the post a link was on, never for the person: a slug
 * (`parseSourceRef`) and the time it was kept, in the same storage the first-run
 * draft uses, so it survives a reload and the round trip to an email code. It is
 * not part of the draft record, which a flow reads as "there is a draft" the
 * moment it exists, and arriving on a link is not a draft.
 *
 * **Never sent anywhere but `create-circle`**, which writes it to the circle's
 * founder-only cohort row. It is in no analytics event, no log line and no
 * address after the arrival. Twenty-four hours after it was kept, like the
 * draft, it is gone. The first tag a visit carried wins until then, so a second
 * link opened on the way does not rewrite where the person began.
 */
export const ARRIVAL_TAG_KEY = 'circles.arrival-tag';
export const ARRIVAL_TAG_TTL_MS = 24 * 60 * 60 * 1000;

const Kept = z.object({ tag: z.string(), at: z.number().int() });

/** The tag kept on this device, or `undefined`: none, expired, unreadable. */
export async function readArrivalTag(now: number = Date.now()): Promise<string | undefined> {
  let raw: string | null;
  try {
    raw = await sessionStorage.getItem(ARRIVAL_TAG_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  let kept: z.infer<typeof Kept> | undefined;
  try {
    const parsed = Kept.safeParse(JSON.parse(raw));
    kept = parsed.success ? parsed.data : undefined;
  } catch {
    kept = undefined;
  }
  const tag = kept === undefined ? undefined : parseSourceRef(kept.tag);
  if (kept === undefined || tag === undefined || now - kept.at >= ARRIVAL_TAG_TTL_MS) {
    await clearArrivalTag();
    return undefined;
  }
  return tag;
}

/** Keeps a tag that is a slug; anything else is dropped and nothing is kept. */
export async function keepArrivalTag(value: unknown, now: number = Date.now()): Promise<void> {
  const tag = parseSourceRef(value);
  if (tag === undefined) return;
  if ((await readArrivalTag(now)) !== undefined) return;
  try {
    await sessionStorage.setItem(ARRIVAL_TAG_KEY, JSON.stringify({ tag, at: now }));
  } catch {
    // The device would not keep it. A label lost is a post not counted, and
    // nothing the person does depends on it.
  }
}

export async function clearArrivalTag(): Promise<void> {
  try {
    await sessionStorage.removeItem(ARRIVAL_TAG_KEY);
  } catch {
    // Expires by itself.
  }
}

/**
 * Guards live here, in code, not in prompts. Every one of them is a reason
 * the publisher refuses to post. They are checked in order; the first
 * failure wins and is printed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { CAPTION_LIMIT, type Platform, type QueueItem } from '../lib/queue.ts';

/** Platforms a script may ever post to. TikTok and Reddit are human-only. */
export const SCRIPTABLE: ReadonlySet<Platform> = new Set(['bluesky', 'threads', 'instagram', 'linkedin']);

/** Posts per platform per UTC day. Deliberately far below the API limits. */
export const DAILY_CAP: Record<string, number> = {
  bluesky: 3,
  threads: 3,
  instagram: 2,
  linkedin: 1,
};

/** `from` is the link tag the post carried (lib/links.ts); older rows have none. */
export type Ledger = { date: string; platform: string; slug: string; id: string; at: string; from?: string }[];

export function readLedger(path = 'publish/ledger.jsonl'): Ledger {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function guardItem(item: QueueItem, now: Date): GuardResult {
  const { fm } = item;
  if (fm.status !== 'approved') return { ok: false, reason: `status is "${fm.status}", not "approved"` };
  if (!fm.publish_at) return { ok: false, reason: 'no publish_at' };
  const at = new Date(fm.publish_at);
  if (Number.isNaN(at.getTime())) return { ok: false, reason: `publish_at "${fm.publish_at}" is not a date` };
  const windowMs = (fm.publish_window_minutes || 0) * 60_000;
  if (now.getTime() < at.getTime()) return { ok: false, reason: `not yet: publish_at ${fm.publish_at}` };
  if (now.getTime() > at.getTime() + Math.max(windowMs, 6 * 3_600_000) + 24 * 3_600_000) {
    return { ok: false, reason: 'stale: more than a day past its window; re-date it or drop it' };
  }
  if (!item.fm.platforms?.length) return { ok: false, reason: 'no platforms' };
  if (/\[VERIFY\]/.test(item.raw)) return { ok: false, reason: 'contains [VERIFY] marker' };
  if (/[!]/.test(Object.values(item.captions).map((c) => c?.text ?? '').join('\n'))) {
    return { ok: false, reason: 'a caption has an exclamation mark (voice.md)' };
  }
  return { ok: true };
}

export function guardPlatform(
  item: QueueItem,
  platform: Platform,
  ledger: Ledger,
  now: Date,
): GuardResult {
  if (!SCRIPTABLE.has(platform)) return { ok: false, reason: `${platform} is human-only; post by hand` };
  const caption = item.captions[platform];
  if (!caption) return { ok: false, reason: `no ## ${platform} caption` };
  const len = caption.text.length + (caption.hashtags.length ? caption.hashtags.join(' ').length + 2 : 0);
  if (len > CAPTION_LIMIT[platform]) return { ok: false, reason: `${platform} caption is ${len} chars, limit ${CAPTION_LIMIT[platform]}` };
  if (item.fm.published?.[platform]) return { ok: false, reason: `already published (${item.fm.published[platform]})` };
  if (ledger.some((r) => r.slug === item.fm.slug && r.platform === platform)) {
    return { ok: false, reason: 'already in ledger (idempotency)' };
  }
  const today = now.toISOString().slice(0, 10);
  const todayCount = ledger.filter((r) => r.platform === platform && r.date === today).length;
  if (todayCount >= (DAILY_CAP[platform] ?? 1)) {
    return { ok: false, reason: `daily cap reached for ${platform} (${todayCount}/${DAILY_CAP[platform]})` };
  }
  // Same text on two platforms is a reviewer fail; the publisher refuses it too.
  for (const [other, c] of Object.entries(item.captions)) {
    if (other !== platform && c && c.text.trim() === caption.text.trim()) {
      return { ok: false, reason: `caption is identical to ## ${other}; platform-native rewrites only` };
    }
  }
  if (item.fm.media === 'slideshow') {
    const dir = `out/${item.fm.slug}`;
    if (!existsSync(`${dir}/01.png`)) return { ok: false, reason: `no rendered slides in ${dir}; run npm run render` };
  }
  return { ok: true };
}

/** Deterministic jitter inside the window, seeded by slug + platform, so a
 *  re-run picks the same minute and two platforms never fire together. */
export function jitterMinutes(seed: string, windowMinutes: number): number {
  if (!windowMinutes) return 0;
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % windowMinutes;
}

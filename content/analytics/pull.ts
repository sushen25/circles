/**
 * Append one row per published post per day to analytics/posts.jsonl.
 *
 *   npm run analytics
 *
 * Bluesky is pulled from the public API (no auth). Threads and Instagram
 * use the same tokens as the publisher. TikTok has no insights API for a
 * personal account: enter views, saves and shares by hand in
 * experiments.md once a week. The weekly /review pass reads this file.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { listQueue, type Platform } from '../lib/queue.ts';
import { sourceRef } from '../lib/links.ts';

const OUT = 'analytics/posts.jsonl';
const today = new Date().toISOString().slice(0, 10);

/** `from` is the post's link tag; Wenna's founder screen reads arrivals by the same value (circles SUS-240). */
type Row = { date: string; slug: string; family: string; platform: string; id: string; from: string; metrics: Record<string, number> };

async function bluesky(uri: string): Promise<Record<string, number>> {
  const r = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`);
  if (!r.ok) throw new Error(`bluesky ${r.status}`);
  const j = (await r.json()) as { posts: { likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number }[] };
  const p = j.posts[0] ?? {};
  return { likes: p.likeCount ?? 0, reposts: p.repostCount ?? 0, replies: p.replyCount ?? 0, quotes: p.quoteCount ?? 0 };
}

async function threads(id: string): Promise<Record<string, number>> {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) return {};
  const r = await fetch(`https://graph.threads.net/v1.0/${id}/insights?metric=views,likes,replies,reposts,quotes,shares&access_token=${token}`);
  if (!r.ok) throw new Error(`threads ${r.status}`);
  const j = (await r.json()) as { data: { name: string; values: { value: number }[] }[] };
  return Object.fromEntries(j.data.map((d) => [d.name, d.values[0]?.value ?? 0]));
}

async function instagram(id: string): Promise<Record<string, number>> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return {};
  const r = await fetch(`https://graph.facebook.com/v21.0/${id}/insights?metric=reach,saved,shares,likes,comments&access_token=${token}`);
  if (!r.ok) throw new Error(`instagram ${r.status}`);
  const j = (await r.json()) as { data: { name: string; values: { value: number }[] }[] };
  return Object.fromEntries(j.data.map((d) => [d.name, d.values[0]?.value ?? 0]));
}

const pullers: Record<string, (id: string) => Promise<Record<string, number>>> = { bluesky, threads, instagram };

async function run() {
  if (!existsSync('published')) {
    console.log('nothing published yet');
    return;
  }
  mkdirSync('analytics', { recursive: true });
  const items = listQueue('published');
  let rows = 0;
  for (const item of items) {
    for (const [platform, id] of Object.entries(item.fm.published ?? {})) {
      const pull = pullers[platform];
      if (!pull) continue;
      try {
        const metrics = await pull(id);
        const row: Row = { date: today, slug: item.fm.slug, family: item.fm.family, platform, id, from: sourceRef(platform as Platform, item.fm.slug), metrics };
        appendFileSync(OUT, JSON.stringify(row) + '\n');
        rows++;
        console.log(`${item.fm.slug} ${platform}`, metrics);
      } catch (e) {
        console.error(`FAIL ${item.fm.slug} ${platform}: ${(e as Error).message}`);
      }
    }
  }
  console.log(`${rows} rows appended to ${OUT}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

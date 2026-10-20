/**
 * Publish approved queue items. Nothing is posted unless every guard in
 * guards.ts passes for that item and that platform.
 *
 *   npm run publish              # post what is due
 *   npm run publish -- --dry-run # print the plan, post nothing
 *   npm run publish -- --now     # ignore publish_at (still needs approved)
 *
 * After a platform succeeds the post id is written into the queue file's
 * `published:` map and appended to publish/ledger.jsonl. Once every
 * scriptable platform on the item is done, the file moves to published/.
 * TikTok and Reddit entries are printed for hand posting and never block
 * the move.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { addPublishedIds, listQueue, setFrontmatterKey, type Platform, type QueueItem } from '../lib/queue.ts';
import { adapters, type Media } from './adapters.ts';
import { sourceRef, tagLinks } from '../lib/links.ts';
import { SCRIPTABLE, guardItem, guardPlatform, jitterMinutes, readLedger } from './guards.ts';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const NOW = args.has('--now');
const LEDGER = 'publish/ledger.jsonl';
const now = new Date();

function mediaFor(item: QueueItem): Media {
  if (item.fm.media !== 'slideshow') return { localPaths: [], publicUrls: [] };
  const dir = `out/${item.fm.slug}`;
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^\d{2}\.png$/.test(f))
        .sort()
    : [];
  const base = process.env.MEDIA_BASE_URL?.replace(/\/$/, '');
  const mp4 = `${dir}/${item.fm.slug}.mp4`;
  return {
    localPaths: files.map((f) => join(dir, f)),
    publicUrls: base ? files.map((f) => `${base}/${item.fm.slug}/${f}`) : [],
    ...(base && existsSync(mp4) ? { videoUrl: `${base}/${item.fm.slug}/${item.fm.slug}.mp4` } : {}),
  };
}

async function urlsReachable(urls: string[]): Promise<string | null> {
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'HEAD' });
      if (!r.ok) return `${u} returned ${r.status}`;
    } catch (e) {
      return `${u}: ${(e as Error).message}`;
    }
  }
  return null;
}

async function run() {
  const ledger = readLedger(LEDGER);
  const items = listQueue('queue');
  if (!items.length) {
    console.log('queue/ is empty');
    return;
  }

  for (const item of items) {
    const tag = basename(item.path);
    const g = NOW && item.fm.status === 'approved' ? { ok: true as const } : guardItem(item, now);
    if (!g.ok) {
      console.log(`skip  ${tag}: ${g.reason}`);
      continue;
    }

    const media = mediaFor(item);
    const results: Record<string, string> = {};
    let allDone = true;

    for (const platform of item.fm.platforms as Platform[]) {
      if (!SCRIPTABLE.has(platform)) {
        const c = item.captions[platform];
        const handText = c ? tagLinks(c.text, platform, item.fm.slug) : '';
        console.log(
          `hand  ${tag} → ${platform}: post by hand (link tag ${sourceRef(platform, item.fm.slug)})${c?.title ? `\n      title: ${c.title}` : ''}${c ? `\n      "${handText}"` : ''}`,
        );
        continue;
      }
      const pg = guardPlatform(item, platform, ledger, now);
      if (!pg.ok) {
        console.log(`skip  ${tag} → ${platform}: ${pg.reason}`);
        if (!/already/.test(pg.reason)) allDone = false;
        continue;
      }

      const wait = jitterMinutes(`${item.fm.slug}:${platform}`, item.fm.publish_window_minutes);
      const due = new Date(new Date(item.fm.publish_at).getTime() + wait * 60_000);
      if (!NOW && now < due) {
        console.log(`wait  ${tag} → ${platform}: jittered to ${due.toISOString()}`);
        allDone = false;
        continue;
      }

      const needsUrls = platform === 'threads' || platform === 'instagram';
      if (needsUrls && media.localPaths.length && !media.publicUrls.length) {
        console.log(`skip  ${tag} → ${platform}: MEDIA_BASE_URL not set; ${platform} fetches images by URL`);
        allDone = false;
        continue;
      }

      if (DRY) {
        const what = platform === 'instagram' && media.videoUrl ? `reel ${media.videoUrl}` : `${media.localPaths.length} images`;
        console.log(`would ${tag} → ${platform} [${sourceRef(platform, item.fm.slug)}]: "${tagLinks(item.captions[platform]!.text, platform, item.fm.slug).slice(0, 80)}" + ${what}`);
        allDone = false;
        continue;
      }

      if (needsUrls) {
        const bad = await urlsReachable(platform === 'instagram' && media.videoUrl ? [media.videoUrl] : media.publicUrls);
        if (bad) {
          console.log(`skip  ${tag} → ${platform}: media not reachable: ${bad}`);
          allDone = false;
          continue;
        }
      }

      try {
        const caption = item.captions[platform]!;
        const from = sourceRef(platform, item.fm.slug);
        const id = await adapters[platform]({ ...caption, text: tagLinks(caption.text, platform, item.fm.slug) }, media);
        results[platform] = id;
        ledger.push({ date: now.toISOString().slice(0, 10), platform, slug: item.fm.slug, id, at: now.toISOString(), from });
        appendFileSync(LEDGER, JSON.stringify(ledger.at(-1)) + '\n');
        console.log(`post  ${tag} → ${platform}: ${id}`);
      } catch (e) {
        console.error(`FAIL  ${tag} → ${platform}: ${(e as Error).message}`);
        allDone = false;
      }
    }

    if (Object.keys(results).length) {
      let raw = addPublishedIds(item.raw, results);
      if (allDone) raw = setFrontmatterKey(raw, 'status', 'published');
      writeFileSync(item.path, raw);
      if (allDone) {
        mkdirSync('published', { recursive: true });
        renameSync(item.path, join('published', basename(item.path)));
        console.log(`done  ${tag} → published/`);
      }
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

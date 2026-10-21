/**
 * Publish approved queue items. Nothing is posted unless every guard in
 * guards.ts passes for that item and that platform.
 *
 *   npm run publish              # post what is due
 *   npm run publish -- --dry-run # print the plan, post nothing
 *   npm run publish -- --now     # ignore publish_at (still needs approved)
 *   npm run publish -- --only youtube  # one platform; the rest wait for the next run
 *
 * After a platform succeeds the post id is written into the queue file's
 * `published:` map and appended to publish/ledger.jsonl. Once every
 * scriptable platform on the item is done, the file moves to published/.
 * TikTok is sent as a draft to the founder's inbox and logged "drafted",
 * not "posted": the founder finishes it in the app (ADR 0086). Reddit
 * entries are printed for hand posting and never block the move.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { addPublishedIds, listQueue, setFrontmatterKey, type Platform, type QueueItem } from '../lib/queue.ts';
import { adapters, youtubePrivacy, type Media } from './adapters.ts';
import { sourceRef, tagLinks } from '../lib/links.ts';
import { DRAFT_ONLY, SCRIPTABLE, guardItem, guardPlatform, jitterMinutes, readLedger } from './guards.ts';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const NOW = args.has('--now');
const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? (argv[argv.indexOf('--only') + 1] as Platform | undefined) : undefined;
if (argv.includes('--only') && !ONLY) throw new Error('--only needs a platform, e.g. --only youtube');
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
  const jpgs = files.map((f) => f.replace(/\.png$/, '.jpg')).filter((f) => existsSync(join(dir, f)));
  return {
    localPaths: files.map((f) => join(dir, f)),
    publicUrls: base ? files.map((f) => `${base}/${item.fm.slug}/${f}`) : [],
    ...(base && existsSync(mp4) ? { videoUrl: `${base}/${item.fm.slug}/${item.fm.slug}.mp4` } : {}),
    ...(existsSync(mp4) ? { videoPath: mp4 } : {}),
    ...(base && jpgs.length === files.length && jpgs.length ? { photoUrls: jpgs.map((f) => `${base}/${item.fm.slug}/${f}`) } : {}),
  };
}

/** The credentials a platform's adapter reads; one missing is a skip, not a failure. */
const NEEDS_ENV: Partial<Record<Platform, string[]>> = {
  youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN'],
};
const missingEnv = (p: Platform) => (NEEDS_ENV[p] ?? []).filter((k) => !process.env[k]);

/** The dry-run's account of what a platform would get. */
function describe(item: QueueItem, platform: Platform, media: Media, tiktokPhotos: boolean): string {
  switch (platform) {
    case 'instagram':
      return media.videoUrl ? `reel ${media.videoUrl}` : `${media.publicUrls.length} images`;
    case 'threads':
      return media.videoUrl ? `video ${media.videoUrl}` : `${media.publicUrls.length} images`;
    case 'bluesky':
      return media.videoPath ? `video ${media.videoPath}` : `${Math.min(media.localPaths.length, 4)} images`;
    case 'youtube':
      return `short ${media.videoPath} (${youtubePrivacy()}), title "${item.captions.youtube!.title}"`;
    case 'tiktok':
      return tiktokPhotos ? `photo draft, ${media.photoUrls!.length} JPEGs by URL` : `video draft ${media.videoPath} (caption pasted by hand)`;
    default:
      return `${media.localPaths.length} images`;
  }
}

/** The line for a post the founder makes by hand: the tag to carry, the title and the tagged text, so the pull can claim it by the tag. */
function handLine(item: QueueItem, platform: Platform, tag: string): string {
  const c = item.captions[platform];
  const handText = c ? tagLinks(c.text, platform, item.fm.slug) : '';
  return `hand  ${tag} → ${platform}: post by hand (link tag ${sourceRef(platform, item.fm.slug)})${c?.title ? `\n      title: ${c.title}` : ''}${c ? `\n      "${handText}"` : ''}`;
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

/** Meta's tokens last 60 days; npm run refresh:tokens renews them and records the dates. */
function warnExpiring() {
  for (const [name, key] of [['Threads', 'THREADS_TOKEN_EXPIRES'], ['Instagram', 'IG_TOKEN_EXPIRES']] as const) {
    const until = process.env[key];
    if (!until) continue;
    const days = Math.floor((new Date(until).getTime() - now.getTime()) / 86_400_000);
    if (days <= 10) console.warn(`warn  ${name} token ${days < 0 ? 'expired' : `expires in ${days} days`} (${until}); run npm run refresh:tokens -- --github`);
  }
}

async function run() {
  warnExpiring();
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
      if (ONLY && platform !== ONLY) {
        allDone = false;
        continue;
      }
      if (!SCRIPTABLE.has(platform)) {
        console.log(handLine(item, platform, tag));
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

      // TikTok takes JPEG stills by URL as a photo draft, or else the MP4 as a file.
      let tiktokPhotos = platform === 'tiktok' && !!media.photoUrls?.length;
      if (platform === 'tiktok' && !tiktokPhotos && !media.videoPath) {
        console.log(`skip  ${tag} → tiktok: no MP4, and no JPEG stills at MEDIA_BASE_URL; run npm run video`);
        allDone = false;
        continue;
      }

      if (DRY) {
        const what = describe(item, platform, media, tiktokPhotos);
        const verb = DRAFT_ONLY.has(platform) ? 'would draft' : 'would';
        const unset = missingEnv(platform);
        console.log(
          `${verb} ${tag} → ${platform} [${sourceRef(platform, item.fm.slug)}]: "${tagLinks(item.captions[platform]!.text, platform, item.fm.slug).slice(0, 80)}" + ${what}${unset.length ? `\n      (not configured: ${unset.join(', ')} unset; a real run skips it)` : ''}`,
        );
        allDone = false;
        continue;
      }

      const unset = missingEnv(platform);
      if (unset.length) {
        console.log(`skip  ${tag} → ${platform}: not configured (${unset.join(', ')} unset; see .env.example, then npm run auth:${platform})`);
        // The hand line the human-only platforms get, so a Short uploaded by hand carries from=yt-<slug> and the pull claims it.
        console.log(handLine(item, platform, tag));
        allDone = false;
        continue;
      }

      if (needsUrls || tiktokPhotos) {
        const bad = await urlsReachable(
          tiktokPhotos ? media.photoUrls! : (platform === 'instagram' || platform === 'threads') && media.videoUrl ? [media.videoUrl] : media.publicUrls,
        );
        if (bad && tiktokPhotos && media.videoPath) {
          // The stills were never uploaded (the runner renders but cannot upload): send the MP4 instead.
          console.log(`note  ${tag} → tiktok: stills not reachable (${bad}); sending the MP4 as a video draft`);
          tiktokPhotos = false;
        } else if (bad) {
          console.log(`skip  ${tag} → ${platform}: media not reachable: ${bad}`);
          allDone = false;
          continue;
        }
      }

      try {
        const caption = item.captions[platform]!;
        const from = sourceRef(platform, item.fm.slug);
        const text = tagLinks(caption.text, platform, item.fm.slug);
        const id = await adapters[platform]({ ...caption, text }, platform === 'tiktok' && !tiktokPhotos ? { ...media, photoUrls: undefined } : media);
        results[platform] = id;
        const kind = DRAFT_ONLY.has(platform) ? 'drafted' : 'posted';
        ledger.push({ date: now.toISOString().slice(0, 10), platform, slug: item.fm.slug, id, at: now.toISOString(), from, kind });
        appendFileSync(LEDGER, JSON.stringify(ledger.at(-1)) + '\n');
        if (kind === 'drafted') {
          console.log(`draft ${tag} → ${platform}: ${id} (in the TikTok inbox; add a sound and post it in the app)`);
          if (!tiktokPhotos) console.log(`      caption to paste: "${text}"`);
        } else {
          console.log(`post  ${tag} → ${platform}: ${id}`);
          if (platform === 'youtube' && youtubePrivacy() !== 'public') {
            console.log(`      ${youtubePrivacy()} on YouTube; set it to Public (or schedule it) in Studio: https://studio.youtube.com/video/${id}/edit`);
          }
        }
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

/**
 * The publisher's loop, with everything it touches passed in so a test can
 * drive it: the adapters (what posts), the journal (what makes a second post
 * impossible, lib/databranch.ts) and the clock. publish.ts is the command line
 * around it. Nothing is posted unless every guard in guards.ts passes for that
 * item and that platform, and not until the attempt is recorded where no other
 * run, branch or checkout can miss it.
 *
 * The rule the whole file keeps: if it cannot be sure a post has not already
 * gone out, it posts nothing. A post is "not yet gone out" only when no
 * ledger row, no `published:` id and no recorded attempt says otherwise.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { addPublishedIds, listQueue, setFrontmatterKey, type Platform, type QueueItem } from '../lib/queue.ts';
import { youtubePrivacy, type Adapter, type Media } from './adapters.ts';
import { sourceRef, tagLinks } from '../lib/links.ts';
import { DRAFT_ONLY, SCRIPTABLE, guardItem, guardPlatform, jitterMinutes, readLedger } from './guards.ts';
import { attempts, begin, save, unresolved, type Attempt, type Ctx } from '../lib/databranch.ts';

const LEDGER = 'publish/ledger.jsonl';

export type Options = { dry: boolean; now: boolean; only?: Platform };

/** What stands between the publisher and a second post (lib/databranch.ts is the real one). */
export type Journal = {
  /** Every attempt ever recorded. Throws when they cannot be listed. */
  attempts(): Attempt[];
  /** Record that this post is about to be made. Throws unless the record is durable and this call created it. */
  begin(platform: string, slug: string): void;
  /** Save what the run wrote (ledger, ids, moves) to the data branch. Never throws; the run's last step saves again and fails if it cannot. */
  record(message: string): void;
};

export type Deps = {
  adapters: Record<string, Adapter>;
  journal: Journal;
  now?: Date;
  log?: (line: string) => void;
  error?: (line: string) => void;
};

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
function warnExpiring(now: Date) {
  for (const [name, key] of [['Threads', 'THREADS_TOKEN_EXPIRES'], ['Instagram', 'IG_TOKEN_EXPIRES']] as const) {
    const until = process.env[key];
    if (!until) continue;
    const days = Math.floor((new Date(until).getTime() - now.getTime()) / 86_400_000);
    if (days <= 10) console.warn(`warn  ${name} token ${days < 0 ? 'expired' : `expires in ${days} days`} (${until}); run npm run refresh:tokens -- --github`);
  }
}

/** Returns the exit code: 0, or 1 when anything was blocked or failed. A journal that throws stops the run and the error is the caller's. */
export async function runPublish(opts: Options, deps: Deps): Promise<number> {
  const { dry: DRY, now: NOW, only: ONLY } = opts;
  const { adapters, journal } = deps;
  const now = deps.now ?? new Date();
  const out = deps.log ?? console.log;
  const err = deps.error ?? console.error;
  const console_ = { log: out, error: err, warn: out };
  let failed = false;

  warnExpiring(now);
  const ledger = readLedger(LEDGER);

  // A recorded attempt with no ledger row behind it is a post that may have gone out and left no trace here: the run
  // that made it was killed, or its push was rejected, or the branch it wrote to was deleted. Nothing is posted
  // until a person has looked at the platform (npm run posted, or npm run attempt -- clear).
  if (!DRY) {
    const open = unresolved(journal.attempts(), ledger);
    if (open.length) {
      for (const a of open) {
        err(
          `BLOCKED ${a.platform} ${a.slug}: a post was started and the ledger has no row for it, so it may be live. Posting nothing. Look at ${a.platform}; if it is there, \`npm run posted -- ${a.platform} ${a.slug} <url-or-id>\`, and if it is not, \`npm run attempt -- clear ${a.platform} ${a.slug}\`.`,
        );
      }
      return 1;
    }
  }

  // git keeps no empty directory: once the last piece has moved to published/ and been merged, queue/ is gone.
  const items = existsSync('queue') ? listQueue('queue') : [];
  if (!items.length) {
    out('queue/ is empty');
    return 0;
  }

  for (const item of items) {
    const tag = basename(item.path);
    const g = NOW && item.fm.status === 'approved' ? { ok: true as const } : guardItem(item, now);
    if (!g.ok) {
      console_.log(`skip  ${tag}: ${g.reason}`);
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
        console_.log(handLine(item, platform, tag));
        continue;
      }
      const pg = guardPlatform(item, platform, ledger, now);
      if (!pg.ok) {
        console_.log(`skip  ${tag} → ${platform}: ${pg.reason}`);
        if (!/already/.test(pg.reason)) allDone = false;
        continue;
      }

      const wait = jitterMinutes(`${item.fm.slug}:${platform}`, item.fm.publish_window_minutes);
      const due = new Date(new Date(item.fm.publish_at).getTime() + wait * 60_000);
      if (!NOW && now < due) {
        console_.log(`wait  ${tag} → ${platform}: jittered to ${due.toISOString()}`);
        allDone = false;
        continue;
      }

      const needsUrls = platform === 'threads' || platform === 'instagram';
      if (needsUrls && media.localPaths.length && !media.publicUrls.length) {
        console_.log(`skip  ${tag} → ${platform}: MEDIA_BASE_URL not set; ${platform} fetches images by URL`);
        allDone = false;
        continue;
      }

      // TikTok takes JPEG stills by URL as a photo draft, or else the MP4 as a file.
      let tiktokPhotos = platform === 'tiktok' && !!media.photoUrls?.length;
      if (platform === 'tiktok' && !tiktokPhotos && !media.videoPath) {
        console_.log(`skip  ${tag} → tiktok: no MP4, and no JPEG stills at MEDIA_BASE_URL; run npm run video`);
        allDone = false;
        continue;
      }

      if (DRY) {
        const what = describe(item, platform, media, tiktokPhotos);
        const verb = DRAFT_ONLY.has(platform) ? 'would draft' : 'would';
        const unset = missingEnv(platform);
        console_.log(
          `${verb} ${tag} → ${platform} [${sourceRef(platform, item.fm.slug)}]: "${tagLinks(item.captions[platform]!.text, platform, item.fm.slug).slice(0, 80)}" + ${what}${unset.length ? `\n      (not configured: ${unset.join(', ')} unset; a real run skips it)` : ''}`,
        );
        allDone = false;
        continue;
      }

      const unset = missingEnv(platform);
      if (unset.length) {
        console_.log(`skip  ${tag} → ${platform}: not configured (${unset.join(', ')} unset; see .env.example, then npm run auth:${platform})`);
        // The hand line the human-only platforms get, so a Short uploaded by hand carries from=yt-<slug> and the pull claims it.
        console_.log(handLine(item, platform, tag));
        allDone = false;
        continue;
      }

      if (needsUrls || tiktokPhotos) {
        const bad = await urlsReachable(
          tiktokPhotos ? media.photoUrls! : (platform === 'instagram' || platform === 'threads') && media.videoUrl ? [media.videoUrl] : media.publicUrls,
        );
        if (bad && tiktokPhotos && media.videoPath) {
          // The stills were never uploaded (the runner renders but cannot upload): send the MP4 instead.
          console_.log(`note  ${tag} → tiktok: stills not reachable (${bad}); sending the MP4 as a video draft`);
          tiktokPhotos = false;
        } else if (bad) {
          console_.log(`skip  ${tag} → ${platform}: media not reachable: ${bad}`);
          allDone = false;
          continue;
        }
      }

      // Every guard has passed. Record the attempt where nothing can lose it, and only then call the platform. When
      // this throws (the remote cannot be reached, or the tag already exists because another run got here first)
      // the run stops: nothing has been posted and nothing else is tried.
      journal.begin(platform, item.fm.slug);

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
          console_.log(`draft ${tag} → ${platform}: ${id} (in the TikTok inbox; add a sound and post it in the app)`);
          if (!tiktokPhotos) console_.log(`      caption to paste: "${text}"`);
        } else {
          console_.log(`post  ${tag} → ${platform}: ${id}`);
          if (platform === 'youtube' && youtubePrivacy() !== 'public') {
            console_.log(`      ${youtubePrivacy()} on YouTube; set it to Public (or schedule it) in Studio: https://studio.youtube.com/video/${id}/edit`);
          }
        }
      } catch (e) {
        console_.error(`FAIL  ${tag} → ${platform}: ${(e as Error).message}`);
        // The attempt stays recorded: the platform may have taken the post before the error, so the next run posts
        // nothing until a person has looked (see the BLOCKED line above).
        failed = true;
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
        console_.log(`done  ${tag} → published/`);
      }
      // Push the ledger line and the ids now, not at the end of the run: the sooner they are on the data branch, the
      // fewer runs have to be blocked by the attempt tag alone.
      journal.record(`content: publish ${now.toISOString().slice(0, 16)} ${tag}`);
    }
    // After a failure nothing else is posted: the run cannot tell what the failed platform did, so it stops there.
    if (failed) return 1;
  }
  return 0;
}

/** The real journal: tags on the remote for attempts, commits on the data branch for what the run wrote. */
export function gitJournal(ctx: Ctx): Journal {
  return {
    attempts: () => attempts(ctx),
    begin: (platform, slug) => begin(ctx, platform, slug),
    record: (message) => {
      try {
        save(ctx, message, ['queue', 'published', 'publish']);
      } catch (e) {
        console.warn(`warn  could not push the ledger yet (${(e as Error).message}); the last step of the run tries again`);
      }
    },
  };
}

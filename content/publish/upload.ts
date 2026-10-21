/**
 * Upload a piece's renders to the bucket that MEDIA_BASE_URL serves, so
 * Threads, Instagram and TikTok photo drafts (which fetch media by URL,
 * server-side) can reach them. Bluesky, LinkedIn and YouTube upload the
 * local files and never need this. For Wenna the bucket is wenna-media,
 * served at https://media.wenna.app (docs/runbooks/content-media.md).
 *
 *   npm run upload queue/2026-10-14-unpaid-project-manager.md   # one piece
 *   npm run upload -- --approved                                # every approved piece that is due
 *   npm run upload -- --dry-run queue/<file>.md                 # list, send nothing
 *
 * Keys mirror out/: <S3_PREFIX/><slug>/NN.png, NN.jpg and <slug>/<slug>.mp4, the
 * same shape mediaFor() in publish.ts builds URLs from, so MEDIA_BASE_URL
 * must point at the prefix. A file whose MD5 matches the object's ETag is
 * skipped, so re-running is cheap. After uploading, every public URL is
 * HEAD-checked the way the publisher checks it, and a miss fails the run.
 *
 * Config (.env locally, repository secrets on GitHub):
 *   S3_BUCKET              required
 *   S3_REGION              default us-east-1; "auto" for R2
 *   S3_ENDPOINT            R2 or any S3-compatible host; unset for AWS
 *   S3_PREFIX              optional key prefix, no slashes at the ends
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   read by the SDK itself; locally
 *                          the SDK falls back to the AWS CLI's profile (AWS_PROFILE)
 *   MEDIA_BASE_URL         where the bucket is public; the check is skipped without it
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { listQueue, parseQueueFile, type QueueItem } from '../lib/queue.ts';
import { guardItem } from './guards.ts';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const APPROVED = args.includes('--approved');
const files = args.filter((a) => !a.startsWith('--'));

const CONTENT_TYPE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
/** Short, so a re-render under the same names reaches the platforms within five minutes. */
const CACHE_CONTROL = 'public, max-age=300';

function config() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.error('S3_BUCKET is not set; see the header of publish/upload.ts');
    process.exit(2);
  }
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const region = process.env.S3_REGION || (endpoint ? 'auto' : 'us-east-1');
  const prefix = (process.env.S3_PREFIX || '').replace(/^\/+|\/+$/g, '');
  const base = process.env.MEDIA_BASE_URL?.replace(/\/$/, '');
  return { bucket, endpoint, region, prefix, base };
}

/** The files the publisher will reference: numbered stills (PNG, and JPEG for TikTok) and the piece's MP4. */
function renders(item: QueueItem): string[] {
  const dir = `out/${item.fm.slug}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{2}\.(png|jpg)$/.test(f) || f === `${item.fm.slug}.mp4`)
    .sort();
}

function md5(bytes: Buffer): string {
  return createHash('md5').update(bytes).digest('hex');
}

async function unchanged(s3: S3Client, bucket: string, key: string, hash: string): Promise<boolean> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ETag?.replace(/"/g, '') === hash;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (e as Error).name === 'NotFound') return false;
    throw e;
  }
}

async function reachable(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok ? null : `${r.status}`;
  } catch (e) {
    return (e as Error).message;
  }
}

async function run() {
  const items = APPROVED
    ? listQueue('queue').filter((i) => guardItem(i, new Date()).ok)
    : files.map((f) => parseQueueFile(f));
  if (!items.length) {
    console.error(APPROVED ? 'nothing in queue/ is approved and due' : 'usage: npm run upload [--dry-run] [--approved] [queue/<file>.md ...]');
    process.exit(APPROVED ? 0 : 2);
  }

  const { bucket, endpoint, region, prefix, base } = config();
  const s3 = new S3Client({ region, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
  let failed = false;

  for (const item of items) {
    const slug = item.fm.slug;
    const list = renders(item);
    if (!list.length) {
      console.error(`FAIL  ${slug}: nothing rendered in out/${slug}; run npm run render (and npm run video) first`);
      failed = true;
      continue;
    }

    for (const f of list) {
      const path = join('out', slug, f);
      const key = `${prefix ? `${prefix}/` : ''}${slug}/${f}`;
      const bytes = readFileSync(path);
      const hash = md5(bytes);
      const ext = f.slice(f.lastIndexOf('.'));
      if (DRY) {
        console.log(`would ${slug}/${f} → s3://${bucket}/${key} (${(bytes.length / 1024).toFixed(0)} KB, ${CONTENT_TYPE[ext]})`);
        continue;
      }
      try {
        if (await unchanged(s3, bucket, key, hash)) {
          console.log(`same  ${slug}/${f}`);
          continue;
        }
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: CONTENT_TYPE[ext],
            ContentMD5: Buffer.from(hash, 'hex').toString('base64'),
            CacheControl: CACHE_CONTROL,
          }),
        );
        console.log(`put   ${slug}/${f} → s3://${bucket}/${key}`);
      } catch (e) {
        console.error(`FAIL  ${slug}/${f}: ${(e as Error).message}`);
        failed = true;
      }
    }

    if (DRY) continue;
    if (!base) {
      console.log(`note  ${slug}: MEDIA_BASE_URL not set, so the public URLs were not checked`);
      continue;
    }
    for (const f of list) {
      const url = `${base}/${slug}/${f}`;
      const bad = await reachable(url);
      if (bad) {
        console.error(`FAIL  ${url}: ${bad} (is the bucket public at MEDIA_BASE_URL, and does it include S3_PREFIX?)`);
        failed = true;
      } else {
        console.log(`ok    ${url}`);
      }
    }
  }

  if (failed) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

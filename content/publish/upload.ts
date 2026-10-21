/**
 * Put a piece's renders where MEDIA_BASE_URL serves them, before approving it:
 *
 *   npm run upload queue/2026-10-17-only-moves.md
 *   → s3://$MEDIA_BUCKET/only-moves/{NN.png, NN.jpg, only-moves.mp4}
 *
 * The bucket (wenna-media) is private and served by CloudFront at
 * https://media.wenna.app (docs/runbooks/content-media.md). Needs the AWS
 * CLI signed in to that account; AWS_PROFILE picks the profile. The video's
 * frames/, the contact sheet and the caption sheet stay local.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { parseQueueFile } from '../lib/queue.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run upload queue/<file>.md');
  process.exit(2);
}
const { slug } = parseQueueFile(file).fm;
const dir = `out/${slug}`;
const bucket = process.env.MEDIA_BUCKET || 'wenna-media';
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{2}\.(png|jpg)$/.test(f) || f === `${slug}.mp4`) : [];
if (!files.some((f) => f.endsWith('.png'))) {
  console.error(`nothing rendered in ${dir}; run npm run render ${file} (and npm run video) first`);
  process.exit(1);
}
if (!files.includes(`${slug}.mp4`)) console.warn(`no ${slug}.mp4; uploading the stills only (npm run video adds it)`);

// A re-render under the same names reaches the platforms within five minutes.
execFileSync(
  'aws',
  ['s3', 'sync', dir, `s3://${bucket}/${slug}/`, '--exclude', '*', ...files.flatMap((f) => ['--include', f]), '--cache-control', 'public, max-age=300', '--only-show-errors'],
  { stdio: 'inherit' },
);
const base = process.env.MEDIA_BASE_URL?.replace(/\/$/, '');
console.log(`${files.length} files → s3://${bucket}/${slug}/${base ? `\nserved at ${base}/${slug}/` : ''}`);

/**
 * Render a queue file's slideshow to 1080x1920 PNGs.
 *
 *   npm run render queue/2026-10-14-unpaid-project-manager.md
 *   → out/unpaid-project-manager/01.png … 0N.png
 *
 *   npm run render -- --approved
 *   → every queue file with `status: approved` and `media: slideshow`, which
 *     is what the publisher will try to post. The GitHub Action runs this
 *     before `npm run publish`, because out/ is never committed (ADR 0081)
 *     and the slideshow guard refuses an item with no slides on disk.
 *
 * Each still is the poster frame of the same scene the video plays: the
 * page builds the whole skit on one timeline (render/stage.js), seeks to a
 * slide's poster, adds the carousel chrome and screenshots. A component's
 * still() override is used where the poster frame is the wrong picture.
 * No native deps: anything that can run Chromium can render this.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listQueue, parseQueueFile, type QueueItem } from '../lib/queue.ts';
import type { Browser } from 'playwright';
import { build, launch, openStage } from './browser.ts';

function usage(): never {
  console.error('usage: npm run render queue/<file>.md [queue/<file>.md …] | npm run render -- --approved');
  process.exit(2);
}

/** The files to render: the ones named, or every approved slideshow. */
function pick(args: string[]): QueueItem[] {
  if (args.includes('--approved')) {
    if (args.length > 1) usage();
    return listQueue('queue').filter((i) => i.fm.status === 'approved' && i.fm.media === 'slideshow');
  }
  if (!args.length) usage();
  return args.map((f) => parseQueueFile(f));
}

async function main() {
  const items = pick(process.argv.slice(2));
  if (!items.length) {
    console.log('nothing to render: no approved slideshow in queue/');
    return;
  }
  const browser = await launch();
  try {
    for (const item of items) await renderOne(browser, item);
  } finally {
    await browser.close();
  }
}

async function renderOne(browser: Browser, item: QueueItem) {
  if (!item.skit) throw new Error(`${item.path}: no \`\`\`json slideshow block`);
  const outDir = resolve('out', item.fm.slug);
  mkdirSync(outDir, { recursive: true });

  const page = await openStage(browser, 'still');
  await build(page, item.skit);

  const n = item.skit.slides.length;
  const written: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((k) => (window as any).still(k), i);
    const out = join(outDir, `${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: out, type: 'png', fullPage: false });
    written.push(out);
  }
  await page.close();

  // A caption sheet beside the PNGs, for hand-posting to TikTok.
  const sheet = Object.entries(item.captions)
    .map(([p, c]) => `## ${p}\n${c.title ? `title: ${c.title}\n\n` : ''}${c.text}${c.hashtags.length ? `\n\n${c.hashtags.join(' ')}` : ''}`)
    .join('\n\n');
  writeFileSync(join(outDir, 'captions.md'), `# ${item.fm.hook}\n\n${sheet}\n`);

  // Contact sheet for a one-glance review in the PR.
  try {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', join(outDir, '%02d.png'),
      '-vf', `scale=270:-1,tile=${n}x1:padding=8:color=white`,
      '-frames:v', '1', join(outDir, 'contact.png'),
    ]);
  } catch {
    /* ffmpeg optional for stills */
  }

  console.log(`${written.length} slides → ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

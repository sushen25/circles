/**
 * Render a queue file's slideshow to 1080x1920 PNGs.
 *
 *   npm run render queue/2026-10-14-unpaid-project-manager.md
 *   → out/unpaid-project-manager/01.png … 0N.png, and 01.jpg … 0N.jpg
 *     (TikTok photo posts take JPEG or WebP, never PNG)
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
import { parseQueueFile } from '../lib/queue.ts';
import { build, launch, openStage } from './browser.ts';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npm run render queue/<file>.md');
    process.exit(2);
  }
  const item = parseQueueFile(file);
  if (!item.skit) throw new Error(`${file}: no \`\`\`json slideshow block`);
  const outDir = resolve('out', item.fm.slug);
  mkdirSync(outDir, { recursive: true });

  const browser = await launch();
  const page = await openStage(browser, 'still');
  await build(page, item.skit);

  const n = item.skit.slides.length;
  const written: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((k) => (window as any).still(k), i);
    const out = join(outDir, `${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: out, type: 'png', fullPage: false });
    await page.screenshot({ path: out.replace(/\.png$/, '.jpg'), type: 'jpeg', quality: 92, fullPage: false });
    written.push(out);
  }
  await browser.close();

  // A caption sheet beside the PNGs, for pasting the TikTok caption onto the draft.
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

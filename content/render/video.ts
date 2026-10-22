/**
 * Render a queue file's skit as an animated 9:16 MP4 with sound.
 *
 *   npm run video queue/2026-10-14-unpaid-project-manager.md
 *   → out/<slug>/<slug>.mp4   (1080x1920, 30 fps, H.264 + AAC, ~15–20 s)
 *
 *   npm run video -- --approved
 *   → the same for every approved slideshow, as `npm run render -- --approved`
 *     does for the stills. The GitHub Action runs both before publishing, so
 *     YouTube, TikTok and Bluesky (which upload the MP4) have it on the runner.
 *
 * render/video.html lays the skit out as scenes (one component per slide,
 * render/components/) driven by Web Animations on one absolute clock. This script seeks that clock frame by frame and
 * screenshots, so the result is deterministic and never drops frames.
 * Sound cues (message pops, ticks, thuds) are synthesised by FFmpeg, so
 * there are no audio assets to license. Drop a royalty-free track at
 * render/audio/bed.mp3 to add a music bed under them.
 *
 * The build is also the piece's measurement: its seconds (total, before,
 * after, per slide) are written into the queue file's frontmatter as
 * `timing:` (lib/measure.ts), so the nightly pull reads them with no browser.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listQueue, parseQueueFile, type QueueItem } from '../lib/queue.ts';
import { guardItem } from '../publish/guards.ts';
import { setTiming, timingOf, token } from '../lib/measure.ts';
import type { Browser } from 'playwright';
import { build, launch, openStage, type Cue } from './browser.ts';

const FPS = 30;

/** Short synthesised sounds: a sine with an exponential decay. */
const SFX: Record<Cue['kind'], string> = {
  pop: "aevalsrc='0.45*sin(2*PI*820*t)*exp(-t*38)':d=0.16:s=44100",
  send: "aevalsrc='0.32*(sin(2*PI*660*t)+sin(2*PI*990*t))*exp(-t*26)':d=0.2:s=44100",
  tick: "aevalsrc='0.3*sin(2*PI*1480*t)*exp(-t*70)':d=0.08:s=44100",
  thud: "aevalsrc='0.55*sin(2*PI*110*t)*exp(-t*16)':d=0.35:s=44100",
  // the calm tone's lock-in marks: a rising F major pentatonic
  note1: "aevalsrc='0.32*sin(2*PI*698.46*t)*exp(-t*22)':d=0.3:s=44100",
  note2: "aevalsrc='0.32*sin(2*PI*783.99*t)*exp(-t*22)':d=0.3:s=44100",
  note3: "aevalsrc='0.32*sin(2*PI*880.00*t)*exp(-t*22)':d=0.3:s=44100",
  note4: "aevalsrc='0.32*sin(2*PI*1046.50*t)*exp(-t*22)':d=0.3:s=44100",
  note5: "aevalsrc='0.32*sin(2*PI*1174.66*t)*exp(-t*22)':d=0.3:s=44100",
  note6: "aevalsrc='0.32*sin(2*PI*1396.91*t)*exp(-t*22)':d=0.3:s=44100",
  note7: "aevalsrc='0.32*sin(2*PI*1567.98*t)*exp(-t*22)':d=0.3:s=44100",
  note8: "aevalsrc='0.32*sin(2*PI*1760.00*t)*exp(-t*22)':d=0.3:s=44100",
};

function ffmpeg(args: string[]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

function usage(): never {
  console.error('usage: npm run video queue/<file>.md [queue/<file>.md …] | npm run video -- --approved');
  process.exit(2);
}

/** The files to render: the ones named, or every approved slideshow (as render.ts picks them). */
function pick(args: string[]): QueueItem[] {
  if (args.includes('--approved')) {
    if (args.length > 1) usage();
    // The publisher's own item guard: approved, due, not stale, no [VERIFY]. A stale
    // approved file would otherwise be rendered on every scheduled run for nothing.
    return listQueue('queue').filter((i) => i.fm.media === 'slideshow' && guardItem(i, new Date()).ok);
  }
  if (!args.length) usage();
  return args.map((f) => parseQueueFile(f));
}

async function main() {
  const items = pick(process.argv.slice(2));
  if (!items.length) {
    console.log('nothing to render: no approved slideshow is due in queue/');
    return;
  }
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('ffmpeg not found. macOS: brew install ffmpeg; Ubuntu: sudo apt-get install ffmpeg');
    process.exit(2);
  }
  const browser = await launch();
  try {
    for (const item of items) await videoOne(browser, item);
  } finally {
    await browser.close();
  }
}

async function videoOne(browser: Browser, item: QueueItem) {
  if (!item.skit) throw new Error(`${item.path}: no \`\`\`json slideshow block`);
  const outDir = resolve('out', item.fm.slug);
  const frames = join(outDir, 'frames');
  try {
    rmSync(frames, { recursive: true, force: true });
  } catch {
    /* sandboxes without delete: frames are overwritten by index */
  }
  mkdirSync(frames, { recursive: true });

  const page = await openStage(browser, 'video');
  const { total, events, scenes } = await build(page, item.skit);
  writeTiming(item, scenes, total);
  const nFrames = Math.ceil(total * FPS);
  for (let f = 0; f < nFrames; f++) {
    await page.evaluate((t) => (window as any).seek(t), f / FPS);
    await page.screenshot({ path: join(frames, `${String(f).padStart(4, '0')}.png`), type: 'png' });
    if (f % 60 === 0) process.stdout.write(`\r${f}/${nFrames} frames`);
  }
  process.stdout.write(`\r${nFrames}/${nFrames} frames\n`);
  await page.close();

  // Sound cues: one synthesised input per cue, delayed to its time, mixed.
  const mp4 = join(outDir, `${item.fm.slug}.mp4`);
  const bed = resolve('render/audio/bed.mp3');
  const cues = events.filter((e) => SFX[e.kind]).slice(0, 60);
  const args = ['-framerate', String(FPS), '-i', join(frames, '%04d.png')];
  const filters: string[] = [];
  const mixIn: string[] = [];
  cues.forEach((c, i) => {
    args.push('-f', 'lavfi', '-i', SFX[c.kind]);
    filters.push(`[${i + 1}:a]adelay=${Math.round(c.at * 1000)}|${Math.round(c.at * 1000)}[s${i}]`);
    mixIn.push(`[s${i}]`);
  });
  let bedIdx = -1;
  if (existsSync(bed)) {
    bedIdx = cues.length + 1;
    args.push('-stream_loop', '-1', '-i', bed);
    filters.push(`[${bedIdx}:a]volume=0.22,afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5[bed]`);
    mixIn.push('[bed]');
  }
  const haveAudio = mixIn.length > 0;
  if (haveAudio) {
    filters.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:dropout_transition=0,apad[a]`);
  }
  args.push('-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-movflags', '+faststart');
  if (haveAudio) {
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-an');
  }
  args.push('-t', total.toFixed(3), mp4);
  ffmpeg(args);

  console.log(`${total.toFixed(1)} s, ${cues.length} sound cues → ${mp4}`);
}

/** Record the build's seconds in the queue file, only when they changed, so a re-render of the same piece is no diff. */
function writeTiming(item: QueueItem, scenes: { start: number; end: number }[], total: number) {
  const tokens = item.skit!.slides.map((s) => token(s as unknown as Parameters<typeof token>[0]));
  const raw = readFileSync(item.path, 'utf8');
  const next = setTiming(raw, timingOf(scenes, tokens, total));
  if (next !== raw) writeFileSync(item.path, next);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

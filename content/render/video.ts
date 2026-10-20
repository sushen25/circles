/**
 * Render a queue file's skit as an animated 9:16 MP4 with sound.
 *
 *   npm run video queue/2026-10-14-unpaid-project-manager.md
 *   → out/<slug>/<slug>.mp4   (1080x1920, 30 fps, H.264 + AAC, ~15–20 s)
 *
 * render/video.html lays the skit out as scenes (one component per slide,
 * render/components/) driven by Web Animations on one absolute clock. This script seeks that clock frame by frame and
 * screenshots, so the result is deterministic and never drops frames.
 * Sound cues (message pops, ticks, thuds) are synthesised by FFmpeg, so
 * there are no audio assets to license. Drop a royalty-free track at
 * render/audio/bed.mp3 to add a music bed under them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseQueueFile } from '../lib/queue.ts';
import { build, launch, openStage, type Cue } from './browser.ts';

const FPS = 30;

/** Short synthesised sounds: a sine with an exponential decay. */
const SFX: Record<Cue['kind'], string> = {
  pop: "aevalsrc='0.45*sin(2*PI*820*t)*exp(-t*38)':d=0.16:s=44100",
  send: "aevalsrc='0.32*(sin(2*PI*660*t)+sin(2*PI*990*t))*exp(-t*26)':d=0.2:s=44100",
  tick: "aevalsrc='0.3*sin(2*PI*1480*t)*exp(-t*70)':d=0.08:s=44100",
  thud: "aevalsrc='0.55*sin(2*PI*110*t)*exp(-t*16)':d=0.35:s=44100",
};

function ffmpeg(args: string[]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npm run video queue/<file>.md');
    process.exit(2);
  }
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('ffmpeg not found. macOS: brew install ffmpeg');
    process.exit(2);
  }

  const item = parseQueueFile(file);
  if (!item.skit) throw new Error(`${file}: no \`\`\`json slideshow block`);
  const outDir = resolve('out', item.fm.slug);
  const frames = join(outDir, 'frames');
  try {
    rmSync(frames, { recursive: true, force: true });
  } catch {
    /* sandboxes without delete: frames are overwritten by index */
  }
  mkdirSync(frames, { recursive: true });

  const browser = await launch();
  const page = await openStage(browser, 'video');
  const { total, events } = await build(page, item.skit);
  const nFrames = Math.ceil(total * FPS);
  for (let f = 0; f < nFrames; f++) {
    await page.evaluate((t) => (window as any).seek(t), f / FPS);
    await page.screenshot({ path: join(frames, `${String(f).padStart(4, '0')}.png`), type: 'png' });
    if (f % 60 === 0) process.stdout.write(`\r${f}/${nFrames} frames`);
  }
  process.stdout.write(`\r${nFrames}/${nFrames} frames\n`);
  await browser.close();

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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

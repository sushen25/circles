/**
 * Render every component's fixture: its still, then three frames of its
 * scene (25%, 60%, 95% of the way through), side by side.
 *
 *   npm run gallery                 → all components
 *   npm run gallery chat end        → just these
 *   → out/gallery/<type>.png, out/gallery/contact.png (needs ffmpeg)
 *
 * Run it in every renderer PR and look at the sheet.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { registry } from './components/index.js';
import { build, launch, openStage } from './browser.ts';

const FRAMES = [0.25, 0.6, 0.95];
/** The viewer in fixture chats. */
const ME = 'Priya';

function ffmpeg(args: string[]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

async function main() {
  const asked = process.argv.slice(2);
  const unknown = asked.filter((t) => !registry[t]);
  if (unknown.length) {
    console.error(`unknown component(s): ${unknown.join(', ')}\nknown: ${Object.keys(registry).join(', ')}`);
    process.exit(2);
  }
  const types = asked.length ? asked : Object.keys(registry);
  const outDir = resolve('out', 'gallery');
  const tmp = join(outDir, 'frames');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  const browser = await launch();
  const sheets: string[] = [];
  for (const type of types) {
    const comp = registry[type];
    const errs = comp.schema(comp.fixture);
    if (errs.length) throw new Error(`${type}: fixture fails its own schema: ${errs.join('; ')}`);
    const skit = { hook: type, me: ME, slides: [comp.fixture] };
    const parts: string[] = [];

    const still = await openStage(browser, 'still');
    await build(still, skit);
    await still.evaluate(() => (window as any).still(0));
    parts.push(join(tmp, `${type}-still.png`));
    await still.screenshot({ path: parts[0] });
    await still.close();

    const video = await openStage(browser, 'video');
    const { scenes } = await build(video, skit);
    const { start, end } = scenes[0];
    for (const f of FRAMES) {
      const at = start + (end - start) * f;
      await video.evaluate((s) => (window as any).seek(s), at);
      const p = join(tmp, `${type}-${Math.round(f * 100)}.png`);
      await video.screenshot({ path: p });
      parts.push(p);
    }
    await video.close();

    // still | 25% | 60% | 95%, each 360 wide, with a gap; the still is framed
    // apart from the scene frames by a wider gap.
    const sheet = join(outDir, `${type}.png`);
    const inputs = parts.flatMap((p) => ['-i', p]);
    const scaled = parts.map((_, i) => `[${i}]scale=360:-1,pad=iw+${i === 0 ? 40 : 12}:ih:0:0:color=white[s${i}]`).join(';');
    ffmpeg([...inputs, '-filter_complex', `${scaled};${parts.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${parts.length},pad=iw+12:ih+24:12:12:color=white`, sheet]);
    sheets.push(sheet);
    console.log(`${type.padEnd(20)} ${(end - start).toFixed(2)} s → ${sheet}`);
  }
  await browser.close();

  const contact = join(outDir, 'contact.png');
  if (sheets.length === 1) ffmpeg(['-i', sheets[0], contact]);
  else ffmpeg([...sheets.flatMap((s) => ['-i', s]), '-filter_complex', `vstack=inputs=${sheets.length}`, contact]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${sheets.length} components → ${contact}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

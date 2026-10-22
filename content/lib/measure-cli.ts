/**
 * `npm run measure` — print a queue file's feature row (lib/measure.ts).
 *
 *   npm run measure queue/2026-10-20-never-lead-anywhere.md
 *   npm run measure -- --timing queue/2026-10-20-never-lead-anywhere.md
 *
 * `--timing` builds the skit in Chromium first and writes its seconds into
 * the file's `timing:` block, which is what `npm run video` does on the way
 * to publishing; use it for a piece published before the video build kept
 * its timing. Nothing else is written: the nightly pull appends the row to
 * analytics/features.jsonl.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseQueueFile } from './queue.ts';
import { measure, setTiming, timingOf, token } from './measure.ts';
import { readLedger } from '../publish/guards.ts';

async function main() {
  const args = process.argv.slice(2);
  const timing = args.includes('--timing');
  const files = args.filter((a) => a !== '--timing');
  if (!files.length) {
    console.error('usage: npm run measure [-- --timing] queue/<file>.md [queue/<file>.md …]');
    process.exit(2);
  }
  if (timing) {
    const { build, launch, openStage } = await import('../render/browser.ts');
    const browser = await launch();
    try {
      for (const f of files) {
        const item = parseQueueFile(f);
        if (!item.skit) throw new Error(`${f}: no \`\`\`json slideshow block`);
        const page = await openStage(browser, 'video');
        const { scenes, total } = await build(page, item.skit);
        await page.close();
        const tokens = item.skit.slides.map((s) => token(s as unknown as Parameters<typeof token>[0]));
        const raw = readFileSync(f, 'utf8');
        const next = setTiming(raw, timingOf(scenes, tokens, total));
        if (next !== raw) writeFileSync(f, next);
      }
    } finally {
      await browser.close();
    }
  }
  const ledger = readLedger();
  for (const f of files) console.log(JSON.stringify(measure(parseQueueFile(f), ledger, new Date()), null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Check one queue file before review: schema errors per slide, the video's
 * length (total and per slide, measured by building it in Chromium), how
 * often the product is named, and how many slides carry a `caption`.
 *
 *   npm run check queue/2026-10-14-unpaid-project-manager.md
 *
 * Exits 1 on schema errors. Everything else is information for the writer
 * and the reviewer; the rules themselves live in CLAUDE.md and /review.
 */
import { readFileSync } from 'node:fs';
import { parseQueueFile } from './queue.ts';
import { hasHandTag } from './links.ts';
import { resolve } from '../render/components/index.js';
import { captionErrors } from '../render/components/_kit.js';
import { quoteIsVerbatim } from '../render/components/quote.js';
import { build, launch, openStage } from '../render/browser.ts';
import { token, timingOf } from './measure.ts';

const PRODUCT = /\bwenna(?:\.app)?\b/gi;

/** Video length a piece must land in, seconds. */
const MIN_S = 24;
const MAX_S = 32;

/**
 * The named shapes from .claude/skills/skit/SKILL.md as patterns over the
 * slide tokens below. A `skip` may precede any chat slot; a `poll` may stand
 * in a chat slot; `chatlink` is a chat whose message carries the share link.
 */
const CHAT = '(?:skip )?(?:chat|poll) ';
const SHAPES: Record<string, RegExp> = {
  skit: new RegExp(`^cover (?:${CHAT}){2,3}beat (?:skip )?chatlink availability locked end$`),
  'quote-led': new RegExp(`^quote (?:${CHAT}){2}beat (?:skip )?chatlink availability locked end$`),
  'side-chat': new RegExp(`^(?:quote|cover) split (?:dm )?beat (?:skip )?chatlink locked end$`),
  drift: new RegExp(`^cover notification skip notification beat (?:skip )?chatlink availability end$`),
  tetris: new RegExp(`^count calendar ${CHAT}beat (?:(?:skip )?chatlink )?availability locked end$`),
  'demo-first': new RegExp(`^cover chatlink availability locked compare end$`),
};
const SHAPE_ORDER: Record<string, string> = {
  skit: 'cover · chat ×2–3 · beat · chat+link · availability · locked · end',
  'quote-led': 'quote · chat ×2 · beat · chat+link · availability · locked · end',
  'side-chat': 'quote|cover · split · [dm] · beat · chat+link · locked · end',
  drift: 'cover · notification · skip · notification · beat · chat+link · availability · end',
  tetris: 'count · calendar · chat · beat · [chat+link] · availability · locked · end',
  'demo-first': 'cover · chat+link · availability · locked · compare · end',
};

/** Every string inside a value, depth first. A chat link's `url` is skipped:
 *  the same URL is already in the message text, so it would count twice. */
function strings(v: unknown, key = ''): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap((x) => strings(x));
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => (key === 'link' && k === 'url' ? [] : strings(x, k)));
  }
  return [];
}

const label = (s: { type: string; screen?: string }) => (s.type === 'screen' ? `screen/${s.screen}` : s.type);

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npm run check queue/<file>.md');
    process.exit(2);
  }
  const item = parseQueueFile(file);
  if (!item.skit) {
    console.error(`${file}: no \`\`\`json slideshow block`);
    process.exit(1);
  }
  const slides = item.skit.slides as unknown as { type: string; screen?: string; [k: string]: unknown }[];
  console.log(`${file}  (${slides.length} slides)`);

  // schema, plus the two rules that need more than one slide's props:
  // a caption's limits, and a quote being verbatim from context/hooks.md
  const hooksMd = readFileSync('context/hooks.md', 'utf8');
  let errors = 0;
  let captionCount = 0;
  slides.forEach((s, i) => {
    const comp = resolve(s);
    const errs = comp ? comp.schema(s) : [`no component for type "${label(s)}"`];
    errs.push(...captionErrors(s));
    if (s.type !== 'grid' && 'caption' in s) captionCount++;
    if (s.type === 'quote' && typeof s.text === 'string' && !quoteIsVerbatim(s.text, hooksMd)) {
      errs.push('`text` is not a verbatim phrase from context/hooks.md (run /mine first; never paraphrase)');
    }
    errors += errs.length;
    for (const e of errs) console.log(`  ✗ slide ${i + 1} ${label(s)}: ${e}`);
  });
  if (errors) {
    console.log(`\n${errors} schema error(s)`);
    process.exit(1);
  }
  console.log('  schema ok');

  // shape: the order must match the frontmatter's shape
  const shape = item.fm.shape;
  const tokens = slides.map((x) => token(x));
  if (!shape || !SHAPES[shape]) {
    console.log(`  ✗ shape: ${shape ? `"${shape}" is not a shape` : 'none in frontmatter'}; one of ${Object.keys(SHAPES).join(', ')}`);
    process.exitCode = 1;
  } else if (!SHAPES[shape].test(tokens.join(' '))) {
    console.log(`  ✗ shape ${shape}: expects ${SHAPE_ORDER[shape]}; got ${tokens.join(' · ')}`);
    process.exitCode = 1;
  } else {
    console.log(`  shape ${shape} ok`);
  }

  // durations, measured from the same build the video renders
  const browser = await launch();
  try {
    const page = await openStage(browser, 'video');
    const { total, scenes, events } = await build(page, item.skit);
    console.log('\n  slide  type                  seconds');
    scenes.forEach((sc, i) => {
      console.log(`  ${String(i + 1).padStart(5)}  ${label(slides[i]).padEnd(20)}  ${(sc.end - sc.start).toFixed(2).padStart(7)}`);
    });
    const bad = total < MIN_S || total > MAX_S ? `  ✗ outside ${MIN_S}–${MAX_S} s` : '';
    console.log(`  total${' '.repeat(24)}${total.toFixed(2).padStart(7)}   (${events.length} sound cues)${bad}`);
    if (bad) process.exitCode = 1;
    // the after must take less screen time than the before, or the piece becomes an ad
    const { before, after } = timingOf(scenes, tokens, total);
    const adish = after >= before && shape !== 'demo-first' ? '  ✗ the after is not shorter than the before' : '';
    console.log(`  before ${before.toFixed(2)} s · after ${after.toFixed(2)} s (end excluded)${adish}`);
    if (adish) process.exitCode = 1;
  } finally {
    await browser.close();
  }

  // product mentions: occurrences of "wenna" / "wenna.app" in slide props
  // (the end card's drawn wordmark is not a prop and is not counted)
  const perSlide = slides.map((s) => strings(s).reduce((n, t) => n + (t.match(PRODUCT)?.length ?? 0), 0));
  const mentions = perSlide.reduce((a, b) => a + b, 0);
  const where = perSlide.map((n, i) => (n ? `slide ${i + 1} ${label(slides[i])}: ${n}` : '')).filter(Boolean);
  console.log(`\n  product mentions: ${mentions}${where.length ? `  (${where.join(', ')})` : ''}`);

  // links: drafts write wenna.app plain; the publisher adds ?from=<platform>-<slug>
  const handTagged = Object.entries(item.captions).filter(([, c]) => hasHandTag(c!.text)).map(([k]) => k);
  console.log(`  links: ${handTagged.length ? `✗ hand-written ?from= in ${handTagged.join(', ')}; write wenna.app plain, the publisher tags it` : 'plain, tagged on publish'}`);
  if (handTagged.length) process.exitCode = 1;

  // the `caption` modifier (grid's own `caption` heading is not it); at most two per piece
  console.log(`  captions: ${captionCount}${captionCount > 2 ? '  ✗ more than two' : ''}`);
  if (captionCount > 2) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

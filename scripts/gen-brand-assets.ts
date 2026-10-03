/**
 * Renders every raster of the brand mark from the vector masters in
 * `apps/app/assets/brand/` (SUS-98). The masters are the authority; nothing
 * here redraws the mark, it only places a master on a canvas of the size a
 * platform asks for and photographs it.
 *
 * Chromium does the drawing — the same Playwright build the e2e suites use —
 * because it renders SVG exactly as a browser tab will, and because it can set
 * the wordmark in Newsreader from the repo's own font file rather than the
 * Google Fonts `@import` in `wenna-lockup.svg`. Nothing is fetched.
 *
 * After writing, every file is read back and sampled at points whose colour is
 * known (ground, lozenge, wordmark), and the run fails if a pixel is not the
 * brand's hex exactly. That is the acceptance criterion "colours match in the
 * exported PNGs, not just the source", asked of the files themselves.
 *
 * Run: pnpm gen:brand — then commit what changed. Not part of `pnpm check`: a
 * byte comparison would fail on every Chromium upgrade without saying anything
 * about the mark.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { brand } from '../packages/config/src/brand.ts';
import { color } from '../packages/tokens/src/generated.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MASTERS = join(ROOT, 'apps/app/assets/brand');
const ASSETS = join(ROOT, 'apps/app/assets');
const PUBLIC = join(ROOT, 'apps/app/public');
const FONTS = join(ROOT, 'packages/tokens/assets/fonts');

const TERRACOTTA = color.accent; // #C2542F
const PEACH = color.invertAccent; // #E8A07A
const GROUND = color.ground; // #FBF7F1
const DARK = color.invert; // #2E241C
const INK = color.ink; // #221E19

const master = (file: string) =>
  readFileSync(join(MASTERS, file), 'utf8').replace(/<\?xml[^>]*\?>\s*/, '');

/** A master resized to `size` px square, as inline SVG. */
function sized(svg: string, size: number): string {
  return svg.replace(/ width="\d+" height="\d+"/, ` width="${size}" height="${size}"`);
}

const recolour = (svg: string, from: string, to: string) => svg.replaceAll(from, to);

/** The lockup without its web-font `@import`; the page supplies Newsreader instead. */
function lockup(width: number, mark: string, ink: string): string {
  const height = (width * 120) / 420;
  return recolour(recolour(master('wenna-lockup.svg'), TERRACOTTA, mark), INK, ink)
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/ width="420" height="120"/, ` width="${width}" height="${height}"`);
}

const fontFace = (family: string, file: string) =>
  `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${readFileSync(
    join(FONTS, file),
  ).toString('base64')}) format('truetype');}`;

const CSS =
  fontFace('Newsreader', 'Newsreader-Regular.ttf') +
  fontFace('Figtree', 'Figtree-Regular.ttf') +
  'html,body{margin:0;padding:0;background:transparent}' +
  '.c{display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}';

type Sample = readonly [x: number, y: number, hex: string];

type Output = {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  /** `null` leaves the canvas transparent. */
  readonly ground: string | null;
  readonly body: string;
  readonly samples: readonly Sample[];
};

/** A mark of `box` px centred on a `size` px canvas. */
function centred(path: string, size: number, box: number, svg: string, ground: string | null) {
  const top = (size - box) / 2;
  // The top lozenge's centre, 26/120 of the way down the mark: always solid.
  const lozenge: Sample = [size / 2, Math.round(top + (box * 26) / 120), fill(svg)];
  return {
    path,
    width: size,
    height: size,
    ground,
    body: sized(svg, box),
    samples: ground === null ? [lozenge] : [[2, 2, ground], lozenge],
  } satisfies Output;
}

function fill(svg: string): string {
  const found = /<g fill="(#[0-9A-F]{6})"/i.exec(svg);
  if (!found?.[1]) throw new Error('gen-brand-assets: a master has no filled group');
  return found[1].toUpperCase();
}

const mark = master('wenna-mark.svg');
const small = master('wenna-mark-small.svg');
const mono = master('wenna-mark-mono.svg');
const darkMark = recolour(mark, TERRACOTTA, PEACH);

// Android adaptive icons are cropped to as little as a 66/108 circle, and the
// mark reaches 0.9 of its own box from the centre; 320 of 512 keeps the whole
// mark inside the smallest mask. The maskable web icon's safe zone is 80%.
const OUTPUTS: readonly Output[] = [
  centred(`${ASSETS}/icon.png`, 1024, 720, mark, GROUND),
  centred(`${ASSETS}/icon-dark.png`, 1024, 720, darkMark, DARK),
  centred(`${ASSETS}/icon-tinted.png`, 1024, 720, mono, null),
  centred(`${ASSETS}/splash-icon.png`, 1024, 1024, mark, null),
  centred(`${ASSETS}/favicon.png`, 48, 48, small, null),
  centred(`${ASSETS}/android-icon-foreground.png`, 512, 320, mark, null),
  {
    path: `${ASSETS}/android-icon-background.png`,
    width: 512,
    height: 512,
    ground: GROUND,
    body: '',
    samples: [
      [2, 2, GROUND],
      [256, 256, GROUND],
    ],
  },
  centred(`${ASSETS}/android-icon-monochrome.png`, 432, 270, mono, null),
  // Status-bar size is 24 dp; 96 px is xxxhdpi. The small master's heavier
  // dots in the mono master's single colour, so the open seat survives.
  centred(`${ASSETS}/notification-icon.png`, 96, 96, recolour(small, TERRACOTTA, '#FFFFFF'), null),
  centred(`${PUBLIC}/apple-touch-icon.png`, 180, 126, mark, GROUND),
  centred(`${PUBLIC}/icon-192.png`, 192, 134, mark, GROUND),
  centred(`${PUBLIC}/icon-512.png`, 512, 360, mark, GROUND),
  centred(`${PUBLIC}/icon-maskable-512.png`, 512, 400, mark, GROUND),
  ...[16, 32, 48].map((size) => centred(`${PUBLIC}/.favicon-${size}.png`, size, size, small, null)),
  {
    path: `${PUBLIC}/brand/wenna-lockup-2x.png`,
    width: 280,
    height: 80,
    ground: null,
    body: lockup(280, TERRACOTTA, INK),
    samples: [[40, 17, TERRACOTTA]],
  },
  {
    path: `${PUBLIC}/brand/wenna-lockup-dark-2x.png`,
    width: 280,
    height: 80,
    ground: null,
    body: lockup(280, PEACH, color.invertInk),
    samples: [[40, 17, PEACH]],
  },
  {
    path: `${PUBLIC}/og-card.png`,
    width: 1200,
    height: 630,
    ground: GROUND,
    body:
      lockup(630, TERRACOTTA, INK) +
      `<div style="font:400 44px/56px Figtree;color:${color.ink2};margin-top:28px">${brand.descriptor}</div>`,
    // The lockup sits 630 × 180 in a column 264 tall, centred: top at 183.
    samples: [
      [4, 4, GROUND],
      [1196, 626, GROUND],
      [285 + 90, 183 + 39, TERRACOTTA],
    ],
  },
];

/** An `.ico` holding PNG images, which every browser since IE Vista reads. */
function ico(images: readonly { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

/** The PWA manifest, written from `brand` so the name exists in one place. */
function manifest(): string {
  return `${JSON.stringify(
    {
      name: brand.name,
      short_name: brand.name,
      description: brand.descriptor,
      start_url: '/start',
      display: 'standalone',
      background_color: GROUND,
      theme_color: GROUND,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  )}\n`;
}

// The marketing site (SUS-149) is served by middleware, which has no file
// system: it takes the mark as a string and the fonts as plain files at
// `/fonts/`. Both are copied from their masters here and never edited.
const SITE = join(ROOT, 'apps/app/src/features/site');
mkdirSync(`${PUBLIC}/fonts`, { recursive: true });
for (const file of [
  'Figtree-Regular.ttf',
  'Figtree-Medium.ttf',
  'Figtree-SemiBold.ttf',
  'Newsreader-Regular.ttf',
]) {
  copyFileSync(join(FONTS, file), `${PUBLIC}/fonts/${file}`);
}
writeFileSync(
  join(SITE, 'mark.generated.ts'),
  `// Written by \`pnpm gen:brand\` from apps/app/assets/brand/wenna-mark.svg. Do not edit.\n` +
    `export const MARK_MASTER = ${JSON.stringify(mark.replace(/\s+$/, ''))};\n` +
    `export const MARK_MASTER_FILL = '${TERRACOTTA}';\n`,
);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const failures: string[] = [];

for (const output of OUTPUTS) {
  await page.setViewportSize({ width: output.width, height: output.height });
  await page.setContent(
    `<!doctype html><style>${CSS}</style><div class="c" style="width:${output.width}px;height:${output.height}px;background:${output.ground ?? 'transparent'}">${output.body}</div>`,
  );
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(dirname(output.path), { recursive: true });
  const png = await page.screenshot({ omitBackground: output.ground === null });
  writeFileSync(output.path, png);

  const found = await page.evaluate(
    async ({ data, samples }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (!context) throw new Error('no 2d context');
      context.drawImage(image, 0, 0);
      return samples.map(([x, y]) => {
        const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
        const hex = `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
        return { hex: hex.toUpperCase(), alpha: a ?? 0 };
      });
    },
    { data: png.toString('base64'), samples: output.samples },
  );
  output.samples.forEach(([x, y, want], i) => {
    const got = found[i];
    if (got?.hex !== want.toUpperCase() || got.alpha !== 255) {
      failures.push(
        `${output.path.slice(ROOT.length + 1)} (${x},${y}): ${got?.hex}/${got?.alpha}, want ${want}`,
      );
    }
  });
}

await browser.close();

const favicons = [16, 32, 48].map((size) => ({
  size,
  png: readFileSync(`${PUBLIC}/.favicon-${size}.png`),
}));
writeFileSync(`${PUBLIC}/favicon.ico`, ico(favicons));
for (const { size } of favicons) rmSync(`${PUBLIC}/.favicon-${size}.png`);
copyFileSync(join(MASTERS, 'wenna-mark-small.svg'), `${PUBLIC}/favicon.svg`);
writeFileSync(`${PUBLIC}/manifest.webmanifest`, manifest());

if (failures.length > 0) {
  console.error('gen:brand: exported colours do not match the brand hex values\n');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`gen:brand: rendered ${OUTPUTS.length} images; every sampled pixel matches`);

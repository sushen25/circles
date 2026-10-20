// Render the Wenna social avatars from the brand masters in the circles repo.
//   node brand/render-avatars.mjs
// Writes brand/avatar-{light,dark}-1024.png and a circle-crop preview.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const B = resolve(homedir(), 'mnt/circles/apps/app/assets/brand');
const mark = readFileSync(resolve(B, 'wenna-mark.svg'), 'utf8')
  .replace(/^<\?xml[^>]*>\s*/, '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

// Social avatars are shown in a circle, so the mark sits a touch larger than
// on the app icon: scale 6.6 → 792 px of 1024 (app icon uses 6 → 720).
const S = 6.6, off = (1024 - 120 * S) / 2;
const svg = (ground, ink) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<rect width="1024" height="1024" fill="${ground}"/>
<g transform="translate(${off} ${off}) scale(${S})">${mark.replaceAll('#C2542F', ink)}</g></svg>`;

const variants = { light: svg('#FBF7F1', '#C2542F'), dark: svg('#2E241C', '#E8A07A') };
for (const [k, s] of Object.entries(variants)) writeFileSync(`brand/avatar-${k}.svg`, s);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
for (const [k, s] of Object.entries(variants)) {
  await page.setContent(`<html><body style="margin:0">${s}</body></html>`);
  await page.screenshot({ path: `brand/avatar-${k}-1024.png`, clip: { x: 0, y: 0, width: 1024, height: 1024 }, omitBackground: false });
}
// preview: both variants inside circular crops, as the platforms show them
await page.setViewportSize({ width: 880, height: 440 });
await page.setContent(`<html><body style="margin:0;background:#888;display:flex;gap:40px;padding:20px">
<img src="data:image/svg+xml;utf8,${encodeURIComponent(variants.light)}" style="width:400px;height:400px;border-radius:50%">
<img src="data:image/svg+xml;utf8,${encodeURIComponent(variants.dark)}" style="width:400px;height:400px;border-radius:50%"></body></html>`);
await page.screenshot({ path: 'brand/preview.png' });
await browser.close();
console.log('ok');

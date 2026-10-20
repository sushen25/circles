/**
 * Open render/template.html (stills) or render/video.html in Chromium, ready
 * for `build(skit)`. Shared by render, video, gallery and check.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

export type Mode = 'still' | 'video';

export async function launch(): Promise<Browser> {
  // CHROMIUM_PATH lets a machine reuse an existing Chromium instead of
  // running `npx playwright install chromium`. The flag lets file:// pages
  // load the component modules (ES modules are fetched with CORS).
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--allow-file-access-from-files'],
  });
}

export async function openStage(browser: Browser, mode: Mode): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve('render', mode === 'still' ? 'template.html' : 'video.html')).href);
  try {
    await page.waitForFunction(() => (window as any).stageReady === true, null, { timeout: 10_000 });
  } catch {
    throw new Error(`render/${mode === 'still' ? 'template' : 'video'}.html did not load its modules${errors.length ? `: ${errors.join('; ')}` : ''}`);
  }
  await page.evaluate(() => document.fonts.ready);
  return page;
}

export type SceneInfo = { type: string; start: number; end: number; poster: number; still: boolean };
export type Cue = { at: number; kind: 'pop' | 'send' | 'tick' | 'thud' };
export type Built = { total: number; events: Cue[]; scenes: SceneInfo[] };

/** Lay the skit out on the page; waits for the fonts its text pulled in. */
export async function build(page: Page, skit: unknown): Promise<Built> {
  const built = (await page.evaluate((s) => (window as any).build(s), skit)) as Built;
  await page.evaluate(() => document.fonts.ready);
  return built;
}

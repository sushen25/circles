// @ts-check
/**
 * The page side of both renderers. video.html and template.html load this
 * as a module and put build/seek/still on `window` for Playwright.
 *
 * build(skit) lays every slide out as a scene on one Timeline, exactly the
 * same way for stills and video. Video seeks frame by frame; stills seek to
 * each scene's poster frame (or draw the component's still() override).
 */
import { resolve } from './components/index.js';
import { anim, el, esc, injectCss, ms, setTone, takesCaption, Timeline } from './components/_kit.js';

export { captionErrors } from './components/_kit.js';

/** @typedef {{ type: string, start: number, end: number, poster: number, still: boolean }} SceneInfo */

/** @type {{ skit: any, scenes: SceneInfo[], roots: HTMLElement[] }} */
const state = { skit: null, scenes: [], roots: [] };

/** @param {any} skit @param {number} index */
const ctxFor = (skit, index) => ({ me: skit.me || null, index, count: skit.slides.length, cast: skit.cast });

/**
 * @param {{ me?: string, cast?: string[], motion?: string, slides: any[] }} skit
 * @returns {{ total: number, events: import('./components/_kit.js').Cue[], scenes: SceneInfo[] }}
 */
export function build(skit) {
  setTone(skit.motion);
  for (const n of [...state.roots, ...document.querySelectorAll('.blob, .scene')]) n.remove();
  state.scenes = [];
  state.roots = [];
  const tl = new Timeline();
  const blob = el('div', 'blob');
  document.body.appendChild(blob);
  anim(blob, [{ transform: 'translate(0,0) scale(1)' }, { transform: 'translate(260px,-700px) scale(1.25)' }], 0, 45, 'linear');

  state.skit = skit;
  skit.slides.forEach((slide, index) => {
    const comp = resolve(slide);
    if (!comp) throw new Error(`slide ${index + 1}: no component for type "${slide.type}"${slide.screen ? ` / screen "${slide.screen}"` : ''}`);
    injectCss(comp.type, comp.css);
    const root = el('div', 'scene');
    root.dataset.type = comp.type;
    document.body.appendChild(root);
    const start = tl.now;
    const { poster, settled } = comp.scene(slide, ctxFor(skit, index), tl, root);
    if (hasCaption(comp, slide)) captionPill(root, start, slide.caption, settled);
    state.scenes.push({ type: comp.type, start, end: tl.now, poster, still: !!comp.still });
    state.roots.push(root);
  });

  document.getAnimations().forEach((a) => a.pause());
  return { total: tl.now, events: tl.cues, scenes: state.scenes };
}

/** @param {import('./components/_kit.js').Component<any>} comp @param {any} slide */
const hasCaption = (comp, slide) => typeof slide?.caption === 'string' && !!slide.caption.trim() && takesCaption(comp);

/** The caption pill's node. @param {string} text */
const pillNode = (text) => el('div', 'cap', esc(text));

/**
 * The `caption` modifier: the viewer's character speaking, as a pill in the
 * lower left. It rises 0.35 s after its scene appears (or 0.15 s after the scene's `settled`
 * time, when the component gives one) and leaves with the
 * scene (it is a child of the root, so the scene's exit carries it).
 * @param {HTMLElement} root @param {number} start  the slide's start on the timeline @param {string} text @param {number} [settled]
 */
function captionPill(root, start, text, settled) {
  const pill = pillNode(text);
  root.appendChild(pill);
  // The scene appears at its root's first animation, which is later than
  // `start` when a component plays a card first (chat's time skip).
  const delays = root.getAnimations().map((a) => Number(a.effect?.getTiming().delay ?? 0));
  const shownAt = delays.length ? Math.max(start, Math.min(...delays) / 1000) : start;
  // after the scene's punchline when the component says when that is; else just after it appears
  const at = typeof settled === 'number' ? settled + 0.15 : shownAt + 0.35;
  anim(pill, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], at, 0.32);
}

/** @param {number} seconds */
export function seek(seconds) {
  const m = ms(seconds);
  for (const a of document.getAnimations()) {
    a.pause();
    a.currentTime = m;
  }
}

/** The carousel chrome: "3 / 8" and "swipe". @param {number} index @param {number} count */
function chrome(index, count) {
  const c = el('div', 'chrome', `<div class="label">${index + 1} / ${count}</div><div class="label">swipe</div>`);
  c.dataset.chrome = '';
  return c;
}

/**
 * Put slide `index` on screen as its still: the poster frame plus the
 * carousel chrome, or the component's still() override.
 * @param {number} index
 */
export async function still(index) {
  document.querySelectorAll('[data-chrome]').forEach((n) => n.remove());
  let layer = document.getElementById('still-layer');
  if (!layer) {
    layer = el('div');
    layer.id = 'still-layer';
    document.body.appendChild(layer);
  }
  layer.innerHTML = '';
  document.body.classList.remove('still-override');

  const info = state.scenes[index];
  const slide = state.skit.slides[index];
  const comp = /** @type {import('./components/_kit.js').Component<any>} */ (resolve(slide));
  const ctx = ctxFor(state.skit, index);
  if (comp.still) {
    layer.innerHTML = comp.still(slide, ctx);
    document.body.classList.add('still-override');
    layer.firstElementChild?.appendChild(chrome(index, ctx.count));
    if (hasCaption(comp, slide)) layer.firstElementChild?.appendChild(pillNode(slide.caption));
  } else {
    // Rebuild, pose at the poster frame, then freeze that frame into static
    // styles: a live (paused) animation keeps its element on a compositor
    // layer, which snaps fractional positions differently from a static page.
    build(state.skit);
    seek(info.poster);
    for (const a of document.getAnimations()) {
      try {
        /** @type {Animation} */ (a).commitStyles();
      } catch {
        /* not rendered (display: none in still mode): nothing to freeze */
      }
      a.cancel();
      // A landed entrance leaves an identity transform behind; drop it so the
      // element rasterises exactly like an untransformed one.
      const target = /** @type {KeyframeEffect | null} */ (a.effect)?.target;
      if (target instanceof HTMLElement && /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(getComputedStyle(target).transform)) {
        target.style.removeProperty('transform');
      }
    }
    // Only this scene is on screen; take the others out of painting entirely
    // (an invisible scene still changes how Chromium rasterises the page).
    for (const sc of document.querySelectorAll('body > .scene')) {
      if (sc !== state.roots[index]) /** @type {HTMLElement} */ (sc).style.display = 'none';
    }
    const root = state.roots[index];
    root.appendChild(chrome(index, ctx.count));
    // Re-attach the scene so it is painted from scratch as a static page,
    // not from tiles rastered while its animations were live.
    root.style.display = 'none';
    void root.offsetHeight;
    root.style.removeProperty('display');
  }
  await document.fonts.ready;
  return info;
}

// @ts-check
/**
 * The component kit: helpers every component imports. Plain ESM with JSDoc,
 * so the same file loads in Node (schema, fixture) and in Chromium (scene).
 * Nothing here touches `document` at import time.
 *
 * Animation primitives are moved verbatim from the old inline build() in
 * video.html; their timings and easings are the video's look, so change them
 * only on purpose.
 */

/** @typedef {'pop' | 'send' | 'tick' | 'thud'} CueKind */
/** @typedef {{ at: number, kind: CueKind }} Cue */
/**
 * @typedef {object} Ctx
 * @property {string | null} me   the speaker shown as the viewer (right-aligned, accent)
 * @property {number} index       slide index, 0-based
 * @property {number} count       number of slides in the piece
 * @property {string[]} [cast]    optional cast list
 */
/**
 * @template P
 * @typedef {object} Component
 * @property {string} type
 * @property {string} css                      this component's own rules, injected once per page
 * @property {(props: any) => string[]} schema returns [] or human-readable errors
 * @property {P} fixture                       realistic props the gallery renders
 * @property {(props: P, ctx: Ctx, tl: Timeline, root: HTMLElement) => { poster: number }} scene
 * @property {(props: P, ctx: Ctx) => string} [still]  override when the poster frame is the wrong picture
 * @property {boolean} [takesCaption]          false: stage.js never draws a slide's `caption` pill on this component
 */

export const SPRING = 'cubic-bezier(.2, 1.35, .35, 1)';
export const EASE = 'cubic-bezier(.25, .1, .25, 1)';
/** @param {number} s */
export const ms = (s) => Math.round(s * 1000);

/** @param {unknown} s */
export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {string} tag
 * @param {string} [cls]
 * @param {string} [html]
 */
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/**
 * wenna-mark.svg master geometry, untouched; colours from the dark app icon.
 * Five `.seat`s and the dashed `.open` seat are separate so they can animate.
 * @param {string} peach
 */
export const MARK = (peach) => `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  ${[0, 60, 120, 180, 240].map((r) => `<g transform="rotate(${r} 60 60)"><rect class="seat" x="49" y="6" width="22" height="40" rx="11" fill="${peach}"/></g>`).join('')}
  <g transform="rotate(300 60 60)"><rect class="open" x="49" y="6" width="22" height="40" rx="11" fill="none" stroke="${peach}" stroke-width="4" stroke-linecap="round"/></g>
</svg>`;

// Entrances fill both ways; exits fill forwards only, so a scene's exit has
// no effect before it starts (otherwise every scene is visible at frame 0).
/**
 * @param {Element} node
 * @param {Keyframe[]} keyframes
 * @param {number} at   absolute seconds
 * @param {number} dur  seconds
 * @param {string} [easing]
 * @param {FillMode} [fill]
 */
export function anim(node, keyframes, at, dur, easing = EASE, fill = 'both') {
  node.animate(keyframes, { delay: ms(at), duration: ms(dur), fill, easing });
}
/** @param {Element} node @param {number} at @param {number} [dur] */
export const show = (node, at, dur = 0.01) => anim(node, [{ opacity: 0 }, { opacity: 1 }], at, dur);
/** @param {Element} node @param {number} at @param {number} [dur] */
export const hide = (node, at, dur = 0.01) => anim(node, [{ opacity: 1 }, { opacity: 0 }], at, dur, EASE, 'forwards');
/** @param {Element} node @param {number} at @param {number} [dur] */
export const pop = (node, at, dur = 0.32) =>
  anim(node, [{ opacity: 0, transform: 'translateY(40px) scale(.92)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], at, dur, SPRING);
/** @param {Element} node @param {number} at @param {number} [dur] */
export const rise = (node, at, dur = 0.3) =>
  anim(node, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }], at, dur);
/** @param {Element} node @param {number} at @param {number} [dur] */
export const exitUp = (node, at, dur = 0.22) =>
  anim(node, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-70px)' }], at, dur, EASE, 'forwards');
/** Reserve layout space the instant a chat item arrives (max-height 0 → open). @param {Element} node @param {number} at @param {number} [h] */
export const reserve = (node, at, h = 900) =>
  anim(node, [{ maxHeight: '0px', marginTop: '0px' }, { maxHeight: `${h}px`, marginTop: '26px' }], at, 0.08, 'linear');
/** @param {Element} node @param {number} at */
export const unreserve = (node, at) =>
  anim(node, [{ maxHeight: '900px', marginTop: '26px' }, { maxHeight: '0px', marginTop: '0px' }], at, 0.01, 'linear', 'forwards');
/** @param {Element} node @param {number} at */
export const press = (node, at) =>
  anim(node, [{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' }], at, 0.22, EASE, 'none');

/**
 * The clock a piece is built on. Replaces the old shared `t`.
 * A component reads `tl.now` as its start, registers animations at absolute
 * times, and leaves `tl.now` at its end. Cues are the sound events the video
 * mixes in; `child()` shares them.
 */
export class Timeline {
  /** @param {Cue[]} [cues] @param {number} [now] */
  constructor(cues = [], now = 0) {
    /** @type {Cue[]} */
    this.cues = cues;
    this.now = now;
  }
  /** Advance the clock. @param {number} s @returns {number} the new now */
  add(s) {
    this.now += s;
    return this.now;
  }
  /** Push a sound cue at `at` (default: now). @param {CueKind} kind @param {number} [at] */
  cue(kind, at = this.now) {
    this.cues.push({ at, kind });
  }
  /** Fade a scene in. @param {Element} node @param {number} [at] */
  enter(node, at = this.now) {
    show(node, at);
  }
  /** Slide a scene up and out. @param {Element} node @param {number} [at] */
  exit(node, at = this.now) {
    exitUp(node, at);
  }
  /** A clock that starts at this one's `now` and shares its cue list (for modifiers like `split`). */
  child() {
    return new Timeline(this.cues, this.now);
  }
}

/**
 * Inject a component's CSS into the page once, keyed by type. No-op in Node.
 * @param {string} key
 * @param {string} css
 */
export function injectCss(key, css) {
  if (typeof document === 'undefined' || !css) return;
  if (document.head.querySelector(`style[data-css="${key}"]`)) return;
  const s = document.createElement('style');
  s.dataset.css = key;
  s.textContent = css;
  document.head.appendChild(s);
}

/**
 * Height of a stack's content, overflow included. A bottom-anchored stream (justify-content: flex-end)
 * pushes overflow out of its top, where scrollHeight does not count it, so measure it top-anchored.
 * @param {HTMLElement} stream
 */
export function contentHeight(stream) {
  const prev = stream.style.justifyContent;
  stream.style.justifyContent = 'flex-start';
  const h = stream.scrollHeight;
  stream.style.justifyContent = prev;
  return h;
}

/**
 * A new `.scene` inserted just before `before`: for a component that plays
 * an extra full-screen card ahead of its own scene (chat's time skip).
 * @param {HTMLElement} before
 * @param {string} cls
 */
export function sceneBefore(before, cls) {
  const sc = el('div', `scene ${cls}`);
  before.parentNode?.insertBefore(sc, before);
  return sc;
}

/**
 * Big words popping in two at a time; the last pair takes the accent.
 * @param {HTMLElement} sc @param {string} text @param {string} cls
 * @param {number} at @param {number} step @param {number} dur @param {CueKind} kind @param {Timeline} tl
 * @returns {number} the number of lines
 */
export function bigWords(sc, text, cls, at, step, dur, kind, tl) {
  const words = text.split(/\s+/);
  const lines = [];
  for (let i = 0; i < words.length; i += 2) lines.push(words.slice(i, i + 2).join(' '));
  lines.forEach((ln, i) => {
    const w = el('span', cls + (i === lines.length - 1 ? ' accent' : ''), esc(ln));
    sc.appendChild(w);
    pop(w, at + i * step, dur);
    tl.cue(kind, at + i * step);
  });
  return lines.length;
}

// ---- schema helpers -------------------------------------------------------

/** @param {any} p @param {string} k @param {string[]} errs @param {boolean} [optional] */
export function str(p, k, errs, optional = false) {
  const v = p?.[k];
  if (v === undefined || v === null) {
    if (!optional) errs.push(`\`${k}\` is required`);
    return;
  }
  if (typeof v !== 'string') errs.push(`\`${k}\` must be a string`);
  else if (!optional && !v.trim()) errs.push(`\`${k}\` is empty`);
}

/** @param {any} p @param {string} k @param {string[]} errs @param {boolean} [optional] */
export function strList(p, k, errs, optional = false) {
  const v = p?.[k];
  if (v === undefined || v === null) {
    if (!optional) errs.push(`\`${k}\` is required`);
    return;
  }
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) errs.push(`\`${k}\` must be a list of strings`);
}

/**
 * Unknown keys are reported so typos do not silently render defaults.
 * `caption` (the slide modifier stage.js draws) is always accepted, so no
 * component lists it; its own rules are in captionErrors().
 * @param {any} p @param {string[]} keys @param {string[]} errs
 */
export function known(p, keys, errs) {
  for (const k of Object.keys(p ?? {})) if (k !== 'caption' && !keys.includes(k)) errs.push(`unknown prop \`${k}\``);
}

// ---- the `caption` modifier -----------------------------------------------

/**
 * Types that never get the caption pill. `grid` has its own `caption` prop
 * (its heading line); `end` is the product slide on the dark surface, and a
 * first-person line there would read as a testimonial. A component can also
 * opt out by setting `takesCaption: false` on its export.
 */
export const NO_CAPTION = new Set(['grid', 'end']);

/** Does this component draw a slide's `caption` as the pill? @param {{ type: string, takesCaption?: boolean }} comp */
export const takesCaption = (comp) => comp.takesCaption ?? !NO_CAPTION.has(comp.type);

/** Longest caption, in characters (exclusive: a caption is under this). */
export const CAPTION_MAX = 50;

/**
 * Rule errors for a slide's `caption` modifier, [] when it has none or it is
 * fine. For lib/check.ts; schema() does not call it. The `type` is the queue
 * slide's (`grid` keeps its own caption, which is not this modifier).
 * @param {{ type?: string, caption?: unknown }} slide
 * @returns {string[]}
 */
export function captionErrors(slide) {
  if (!slide || !('caption' in slide) || slide.type === 'grid') return [];
  const c = slide.caption;
  if (slide.type === 'end') return ['`caption`: the end slide does not take a caption'];
  if (typeof c !== 'string' || !c.trim()) return ['`caption` must be a non-empty string'];
  const errs = [];
  if (c.trim().length >= CAPTION_MAX) errs.push(`\`caption\` is ${c.trim().length} characters; keep it under ${CAPTION_MAX}`);
  if (/wenna/i.test(c)) errs.push('`caption` names the product; captions are the viewer\'s character, never Wenna');
  if (c.includes('!')) errs.push('`caption` has an exclamation mark');
  return errs;
}

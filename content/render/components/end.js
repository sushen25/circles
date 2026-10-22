// @ts-check
/** The end card: the lockup on the dark surface, the line, the URL. The one product mention. */
import { anim, el, esc, known, MARK, pop, rise, SPRING, str } from './_kit.js';

/** @typedef {{ type: 'end', line: string, url: string, descriptor?: string }} Props */

/** The mark as one static SVG (rects rotated directly, dash as an attribute), for the still. @param {string} colour */
const staticMark = (colour) =>
  `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">${[0, 60, 120, 180, 240]
    .map((r) => `<rect x="49" y="6" width="22" height="40" rx="11" fill="${colour}" transform="rotate(${r} 60 60)"/>`)
    .join('')}<rect x="49" y="6" width="22" height="40" rx="11" fill="none" stroke="${colour}" stroke-width="4" stroke-dasharray="0.5 7" stroke-linecap="round" transform="rotate(300 60 60)"/></svg>`;

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'end',
  css: `
  /* the lockup on the dark surface (brand README: peach on #2E241C) */
  .end { background: var(--invert); color: var(--invert-ink); justify-content: center; }
  .end .lockup { display: flex; align-items: center; gap: 36px; margin-bottom: 28px; }
  .end .lockup svg { width: 230px; height: 230px; overflow: visible; }
  .end .lockup .seat { opacity: 0; transform-box: fill-box; transform-origin: center; }
  .end .lockup .open { stroke-dasharray: 0.5 7; opacity: 0; }
  .end .wordmark { font-family: 'Newsreader', Georgia, serif; font-size: 196px; letter-spacing: -0.03em; line-height: 1; color: var(--invert-ink); opacity: 0; transform-origin: left center; }
  .end .descriptor { font-size: 40px; color: var(--invert-ink-2); margin-bottom: 120px; opacity: 0; }
  .end .display { font-size: 66px; color: var(--invert-ink); }
  .end .display .w { display: inline-block; opacity: 0; }
  .end .url { margin-top: 56px; font-size: 56px; font-weight: 600; color: var(--invert-accent); opacity: 0; }

  /* still override: the carousel end card wraps the line as running text */
  body.still .end-still { background: var(--invert); color: var(--invert-ink); justify-content: center; }
  body.still .end-still .lockup { display: flex; align-items: center; gap: 32px; margin-bottom: 24px; }
  body.still .end-still .lockup svg { width: 200px; height: 200px; }
  body.still .end-still .wordmark { font-family: 'Newsreader', Georgia, serif; font-size: 170px; letter-spacing: -0.03em; line-height: 1; }
  body.still .end-still .descriptor { font-size: 36px; color: var(--invert-ink-2); margin-bottom: 100px; }
  body.still .end-still .display { font-size: 60px; }
  body.still .end-still .url { margin-top: 48px; font-size: 44px; font-weight: 600; color: var(--invert-accent); }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'line', 'url', 'descriptor'], errs);
    str(p, 'line', errs);
    str(p, 'url', errs);
    str(p, 'descriptor', errs, true);
    return errs;
  },
  fixture: {
    type: 'end',
    line: "One link in the chat. Everyone marks the times they'd actually be up for. Someone locks it in.",
    url: 'wenna.app',
  },
  scene(p, ctx, tl, root) {
    root.classList.add('end');
    const t = tl.now;
    const lockup = el('div', 'lockup', MARK('#E8A07A'));
    const word = el('div', 'wordmark', 'wenna');
    lockup.appendChild(word);
    const desc = el('div', 'descriptor', esc(p.descriptor || 'Plans with friends'));
    const d = el('div', 'display');
    const words = p.line.split(/\s+/);
    const url = el('div', 'url', esc(p.url));
    root.append(lockup, desc, d, url);

    // the surface wipes up
    anim(root, [{ opacity: 1, clipPath: 'inset(100% 0 0 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], t, 0.4);
    tl.cue('thud', t);
    // five seats arrive around the table, then the open seat draws itself
    let tt = t + 0.35;
    lockup.querySelectorAll('.seat').forEach((seat, i) => {
      anim(seat, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)' }], tt + i * 0.09, 0.3, SPRING);
      tl.cue('pop', tt + i * 0.09);
    });
    tt += 5 * 0.09 + 0.1;
    const open = /** @type {Element} */ (lockup.querySelector('.open'));
    anim(open, [{ opacity: 0, strokeDashoffset: 60 }, { opacity: 1, strokeDashoffset: 0 }], tt, 0.45);
    tl.cue('tick', tt);
    tt += 0.25;
    anim(word, [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'translateX(0)' }], tt, 0.4);
    tl.cue('send', tt);
    rise(desc, tt + 0.25, 0.3);
    tt += 0.55;
    words.forEach((w, i) => {
      const sp = el('span', 'w', esc(w) + '&nbsp;');
      d.appendChild(sp);
      anim(sp, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }], tt + i * 0.04, 0.28);
    });
    tt += words.length * 0.04 + 0.25;
    pop(url, tt, 0.34);
    tl.cue('send', tt);
    tl.now = tt + 2.0;
    return { poster: tl.now - 0.01 };
  },
  // The video sets the line word by word (inline-blocks) at 66px and draws the
  // mark seat by seat; the carousel end card is the static lockup at 200px with
  // the line as running text at 60px. Different wrapping, so override.
  still(p) {
    return `<div class="slide end-still">
        <div class="lockup">${staticMark('#E8A07A')}<div class="wordmark">wenna</div></div>
        <div class="descriptor">${esc(p.descriptor || 'Plans with friends')}</div>
        <div class="display">${esc(p.line)}</div>
        <div class="url">${esc(p.url)}</div>
      </div>`;
  },
};

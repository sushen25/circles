// @ts-check
/**
 * The opener: the writer's one or two lines, in Figtree, at rest from frame 0 when it is the
 * first slide (that frame is the thumbnail and the muted first second). Line 2 takes the accent.
 */
import { el, esc, HOOK_CPS, known, rise, str } from './_kit.js';

/** @typedef {{ type: 'cover', line1: string, line2?: string }} Props */

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'cover',
  css: `
  .hook { justify-content: center; }
  .hook .ln { display: block; line-height: 1.04; text-wrap: balance; }
  .hook.l .ln { font-size: 150px; }
  .hook.m .ln { font-size: 124px; }
  .hook.s .ln { font-size: 104px; }
  .hook .ln.two { color: var(--accent-dark); }
  /* the still is frame 0: same margins as the video, so a line never wraps differently */
  body.still .scene.hook { padding: 200px 100px 360px; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'line1', 'line2'], errs);
    str(p, 'line1', errs);
    str(p, 'line2', errs, true);
    return errs;
  },
  fixture: { type: 'cover', line1: '13 messages.', line2: 'No date.' },
  scene(p, ctx, tl, root) {
    const lines = [p.line1, p.line2].filter(Boolean);
    root.classList.add('hook');
    const t = tl.now;
    tl.enter(root, t, ctx.index === 0);
    const nodes = lines.map((l, i) => {
      const n = el('div', 'ln' + (i === 1 ? ' two' : ''), esc(l));
      root.appendChild(n);
      return n;
    });
    // the largest size at which every line stays whole and the block fits the safe area; failing
    // that (a line too long for one line at any size), the largest size at which the block fits.
    // Fonts are loaded before build (video.html, template.html), so these measurements are real.
    /** @param {string} size */
    const set = (size) => { root.classList.remove('l', 'm', 's'); root.classList.add(size); };
    const fits = () => nodes.reduce((h, n) => h + n.offsetHeight, 0) <= 1100;
    const whole = () => nodes.every((n) => Math.round(n.offsetHeight / parseFloat(getComputedStyle(n).lineHeight)) === 1);
    const sizes = ['l', 'm', 's'];
    const pick = sizes.find((s) => (set(s), fits() && whole())) ?? sizes.find((s) => (set(s), fits())) ?? 's';
    set(pick);
    if (ctx.index === 0) {
      // the opener is at rest from frame 0: that frame is the thumbnail and the muted first second
      tl.cue('thud', t);
    } else {
      nodes.forEach((n, i) => {
        rise(n, t + 0.08 + i * 0.12, 0.3);
        tl.cue('thud', t + 0.08 + i * 0.12);
      });
    }
    const dur = Math.min(3.0, Math.max(1.5, 0.5 + lines.join(' ').length / HOOK_CPS));
    tl.exit(root, t + dur - 0.22);
    tl.add(dur);
    return { poster: t + dur - 0.23 };
  },
};

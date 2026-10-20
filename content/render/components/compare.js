// @ts-check
/** Before and after, stacked: the before lands, dims, the after lands on top. */
import { anim, EASE, el, esc, known, pop, str, strList } from './_kit.js';

/** @typedef {{ type: 'compare', beforeLabel?: string, before: string[], afterLabel?: string, after: string[] }} Props */

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'compare',
  css: `
  .compare { justify-content: center; gap: 36px; }
  .compare .half { border-radius: 44px; padding: 56px 60px; opacity: 0; transform-origin: left center; }
  .compare .before { background: var(--surface); border: 3px solid var(--line); }
  .compare .after { background: var(--invert); color: var(--invert-ink); }
  .compare .half .lbl { margin-bottom: 26px; }
  .compare .after .lbl { color: var(--invert-accent); }
  .compare .half .ln { font-family: 'Newsreader', Georgia, serif; font-size: 78px; line-height: 1.1; letter-spacing: -0.018em; opacity: 0; }
  .compare .before .ln { color: var(--ink-2); }

  /* still: both halves at full strength (the video dims the before) */
  body.still .compare .half { padding: 52px 56px; }
  body.still .compare .before { border: 2px solid var(--line); opacity: 1 !important; }
  body.still .compare .half .lbl { font-size: 26px; letter-spacing: 0.07em; margin-bottom: 22px; }
  body.still .compare .half .ln { font-size: 72px; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'beforeLabel', 'before', 'afterLabel', 'after'], errs);
    strList(p, 'before', errs);
    strList(p, 'after', errs);
    str(p, 'beforeLabel', errs, true);
    str(p, 'afterLabel', errs, true);
    return errs;
  },
  fixture: {
    type: 'compare',
    beforeLabel: 'Before',
    before: ['14 messages.', 'Three weeks.', 'No date.'],
    afterLabel: 'After',
    after: ['One link.', 'Thursday, 6:30.'],
  },
  scene(p, ctx, tl, root) {
    root.classList.add('compare');
    const t = tl.now;
    /** @param {string} cls @param {string} label @param {string[]} lines */
    const mk = (cls, label, lines) => {
      const h = el('div', 'half ' + cls);
      h.appendChild(el('div', 'lbl', esc(label)));
      const nodes = lines.map((l) => {
        const n = el('div', 'ln', esc(l));
        h.appendChild(n);
        return n;
      });
      root.appendChild(h);
      return { h, nodes };
    };
    const b = mk('before', p.beforeLabel || 'Before', p.before);
    const a = mk('after', p.afterLabel || 'After', p.after);
    tl.enter(root, t);
    pop(b.h, t + 0.05, 0.34);
    tl.cue('thud', t + 0.05);
    b.nodes.forEach((n, i) => anim(n, [{ opacity: 0, transform: 'translateX(-20px)' }, { opacity: 1, transform: 'translateX(0)' }], t + 0.3 + i * 0.22, 0.28));
    let tt = t + 0.3 + b.nodes.length * 0.22 + 0.6;
    anim(b.h, [{ opacity: 1 }, { opacity: 0.5 }], tt, 0.3, EASE, 'forwards');
    pop(a.h, tt, 0.4);
    tl.cue('thud', tt);
    a.nodes.forEach((n, i) => {
      anim(n, [{ opacity: 0, transform: 'translateX(-20px)' }, { opacity: 1, transform: 'translateX(0)' }], tt + 0.3 + i * 0.26, 0.3);
      tl.cue('tick', tt + 0.3 + i * 0.26);
    });
    tt += 0.3 + a.nodes.length * 0.26 + 1.1;
    tl.exit(root, tt - 0.22);
    tl.now = tt;
    return { poster: tt - 0.23 };
  },
};

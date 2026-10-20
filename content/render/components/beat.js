// @ts-check
/** A one-line punch between chats: each word slams in on its own line. */
import { anim, el, esc, known, SPRING, str } from './_kit.js';

/** @typedef {{ type: 'beat', line: string }} Props */

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'beat',
  css: `
  .beat { justify-content: center; }
  .beat .w { display: block; font-size: 170px; color: var(--accent-dark); opacity: 0; transform-origin: left center; }

  body.still .scene.beat .w { font-family: 'Newsreader', Georgia, serif; font-size: 150px; letter-spacing: -0.018em; line-height: 1.08; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'line'], errs);
    str(p, 'line', errs);
    return errs;
  },
  fixture: { type: 'beat', line: 'Every. Single. Time.' },
  scene(p, ctx, tl, root) {
    root.classList.add('beat');
    const t = tl.now;
    const words = p.line.split(/\s+/);
    words.forEach((w, i) => {
      const n = el('span', 'w', esc(w));
      root.appendChild(n);
      anim(n, [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)' }], t + 0.05 + i * 0.3, 0.18, SPRING);
      tl.cue('thud', t + 0.05 + i * 0.3);
    });
    tl.enter(root, t);
    const dur = 0.05 + words.length * 0.3 + 0.6;
    tl.exit(root, t + dur - 0.22);
    tl.add(dur);
    return { poster: t + dur - 0.23 };
  },
};

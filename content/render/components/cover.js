// @ts-check
/** The opener: one or two lines, words popping in two at a time. */
import { bigWords, esc, known, str } from './_kit.js';

/** @typedef {{ type: 'cover', line1: string, line2?: string }} Props */

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'cover',
  css: `
  .hook { justify-content: center; }
  .hook .w { display: block; font-size: 150px; opacity: 0; transform-origin: left center; }
  .hook .w.accent { color: var(--accent-dark); }

  /* still override: the carousel cover keeps line1 / line2 as written, in the serif */
  body.still .cover-still { justify-content: center; }
  body.still .cover-still .display { font-size: 108px; }
  body.still .cover-still .line2 { color: var(--accent-dark); }
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
    root.classList.add('hook');
    const t = tl.now;
    tl.enter(root, t);
    const n = bigWords(root, [p.line1, p.line2].filter(Boolean).join(' '), 'w', t + 0.08, 0.22, 0.34, 'thud', tl);
    const dur = 0.3 + n * 0.22 + 0.7;
    tl.exit(root, t + dur - 0.22);
    tl.add(dur);
    return { poster: t + dur - 0.23 };
  },
  // The video splits the hook into word pairs at 150px; the carousel cover
  // keeps the writer's two lines at 108px. Different pictures, so override.
  still(p) {
    return `<div class="slide cover-still">
        <div class="display">${esc(p.line1)}${p.line2 ? `<br/><span class="line2">${esc(p.line2)}</span>` : ''}</div>
      </div>`;
  },
};

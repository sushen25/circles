// @ts-check
/**
 * The full-screen time-skip card ("Three weeks later" over the chat title).
 * `chat` plays it when its `when` has no digits; the `skip` component calls
 * skipCard() on its own root.
 */
import { el, esc, injectCss, pop } from './_kit.js';

export const css = `
  .inter { justify-content: center; align-items: flex-start; }
  .inter .display { font-size: 132px; color: var(--ink); }
  .inter .sub { margin-top: 28px; font-size: 36px; color: var(--ink-3); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }

  /* still: the card at rest, carousel metrics (only the skip component has a
     still; chat's implicit card is never a slide of its own) */
  body.still .inter .display { font-size: 116px; }
  body.still .inter .sub { margin-top: 24px; font-size: 32px; letter-spacing: 0.07em; }
`;

/** The card's fixed length in seconds, entrance to the end of its exit. */
export const SKIP_DURATION = 0.9;

/**
 * Build the card into `sc` starting at `tl.now`, advance `tl` by its length.
 * @param {HTMLElement} sc  a `.scene` element already in the page
 * @param {string} line     the big line ("Five weeks later")
 * @param {string} [sub]    the small label under it (the chat's title); none when empty
 * @param {import('./_kit.js').Timeline} tl
 */
export function skipCard(sc, line, sub, tl) {
  injectCss('_skip', css);
  sc.classList.add('inter');
  const t = tl.now;
  const d = el('div', 'display', esc(line));
  sc.append(d);
  tl.enter(sc, t);
  pop(d, t + 0.02, 0.3);
  if (sub) {
    const s = el('div', 'sub', esc(sub));
    sc.append(s);
    pop(s, t + 0.12, 0.3);
  }
  tl.cue('thud', t + 0.02);
  tl.exit(sc, t + 0.75);
  tl.add(SKIP_DURATION);
  return { poster: t + 0.74 };
}

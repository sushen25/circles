// @ts-check
/**
 * A verbatim phrase with its source: the opener for quote-archetype hooks.
 * Big serif text in typographic quotes, the source as a small label. The text
 * must be verbatim in context/hooks.md (quoteIsVerbatim, called by check.ts).
 */
import { el, EASE_OUT, anim, esc, known, str } from './_kit.js';

/** @typedef {{ type: 'quote', text: string, source: string }} Props */

/** A subreddit or a channel word; never a username (u/…, @…). */
export const SOURCE = /^(r\/[A-Za-z0-9_]+|DMs?|comments?|a reply)$/;
/** Longest quote that still fits the slide at the smallest size. */
const MAX_LEN = 120;

/** Quote marks, ellipses and spaces at the edges, for comparison with hooks.md only. */
const EDGES = /^[\s"'“”‘’«»…]+|[\s"'“”‘’«»…]+$|^\.{3}|\.{3}$/g;

/** The text with its edges stripped, for quoteIsVerbatim(). @param {string} text */
const core = (text) => {
  let t = text, prev;
  do {
    prev = t;
    t = t.replace(EDGES, '');
  } while (t !== prev);
  return t;
};

/** Pairs of outer quote marks a writer may wrap the text in. */
const PAIRS = [['"', '"'], ['“', '”'], ['«', '»'], ["'", "'"], ['‘', '’']];

/**
 * Text as displayed: only a matching pair of outer quote marks comes off
 * (the slide draws its own). Inner quotes and ellipses stay, so a phrase
 * like …reply with, 'sorry guys…' renders exactly as the person wrote it.
 * @param {string} text
 */
const bare = (text) => {
  const t = text.trim();
  for (const [o, c] of PAIRS) if (t.length > 2 && t.startsWith(o) && t.endsWith(c)) return t.slice(1, -1).trim();
  return t;
};

/** Whitespace collapsed, curly apostrophes and "..." made plain, for comparison. @param {string} s */
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\.\.\./g, '…').replace(/\s+/g, ' ').trim();

/**
 * True when `text` appears verbatim in hooks.md: an exact, case-sensitive
 * substring after collapsing whitespace, ignoring quotes or ellipses around
 * the text, and treating curly and straight apostrophes as the same. Fewer
 * than 8 characters never counts (any short word is "in" the file).
 * @param {string} text   the quote slide's `text`
 * @param {string} hooksMd the contents of context/hooks.md
 */
export function quoteIsVerbatim(text, hooksMd) {
  if (typeof text !== 'string' || typeof hooksMd !== 'string') return false;
  const t = norm(core(text));
  if (t.length < 8) return false;
  return norm(hooksMd).includes(t);
}

/** Font size steps by length, so a 60-character quote sits in four lines or fewer. @param {string} text */
export const sizeFor = (text) => (text.length <= 40 ? 'l' : text.length <= 80 ? 'm' : 's');

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'quote',
  css: `
  .quote { justify-content: center; }
  .quote .q { font-family: 'Newsreader', Georgia, serif; letter-spacing: -0.02em; line-height: 1.08; color: var(--ink); text-indent: -0.42em; text-wrap: balance; }
  .quote .q.l { font-size: 120px; }
  .quote .q.m { font-size: 100px; }
  .quote .q.s { font-size: 80px; }
  .quote .q .g { display: inline-block; text-indent: 0; opacity: 0; }
  .quote .q .mk { color: var(--accent-dark); }
  .quote .src { margin-top: 56px; text-transform: none; letter-spacing: 0.02em; opacity: 0; }

  body.still .scene.quote .q { letter-spacing: -0.018em; line-height: 1.1; }
  body.still .scene.quote .q.l { font-size: 108px; }
  body.still .scene.quote .q.m { font-size: 90px; }
  body.still .scene.quote .q.s { font-size: 72px; }
  body.still .scene.quote .src { margin-top: 48px; font-size: 28px; letter-spacing: 0.02em; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'text', 'source'], errs);
    str(p, 'text', errs);
    str(p, 'source', errs);
    if (typeof p.text === 'string' && bare(p.text).length > MAX_LEN) errs.push(`\`text\` is ${bare(p.text).length} characters; a quote slide holds ${MAX_LEN} at most (lift a shorter run of the phrase)`);
    if (typeof p.source === 'string' && p.source.trim()) {
      if (/^u\/|@/.test(p.source.trim())) errs.push('`source` is a username; give the subreddit or channel only ("r/daddit", "DMs")');
      else if (!SOURCE.test(p.source.trim())) errs.push('`source` must be a subreddit ("r/daddit") or a channel word ("DMs", "comments", "a reply")');
    }
    return errs;
  },
  fixture: { type: 'quote', text: "suddenly it's been a month since we last chatted", source: 'r/daddit' },
  scene(p, ctx, tl, root) {
    root.classList.add('quote');
    const t = tl.now;
    const text = bare(p.text);
    const q = el('div', `q ${sizeFor(text)}`);
    const src = el('div', 'lbl src', esc(p.source.trim()));
    root.append(q, src);

    // Each word is its own inline-block, so the text wraps like running text
    // (the same in the still and the video); words rise in groups of ~3.
    const words = text.split(/\s+/);
    /** @param {number} i */
    const groupOf = (i) => Math.min(Math.floor(i / 3), Math.max(0, Math.ceil((words.length - 1) / 3) - 1));
    const groups = groupOf(words.length - 1) + 1; // a lone last word joins the group before it
    const step = 0.2;
    words.forEach((w, i) => {
      const open = i === 0 ? '<span class="mk">“</span>' : '';
      const close = i === words.length - 1 ? '<span class="mk">”</span>' : '';
      const n = el('span', 'g', open + esc(w) + close);
      q.append(n, ' ');
      const g = groupOf(i);
      const at = t + 0.08 + g * step;
      anim(n, [{ opacity: 0, transform: 'translateY(34px)' }, { opacity: 1, transform: 'translateY(0)' }], at, 0.34, EASE_OUT);
      if (i % 3 === 0 && g === Math.floor(i / 3)) tl.cue('pop', at);
    });
    // the first line's text-indent hangs the opening mark in the margin
    const srcAt = t + 0.08 + (groups - 1) * step + 0.42;
    anim(src, [{ opacity: 0 }, { opacity: 1 }], srcAt, 0.3);
    tl.enter(root, t);
    // reading time grows with length; the whole card stays within 2.5–3.5 s
    const dur = Math.min(3.5, Math.max(2.5, srcAt - t + 0.3 + Math.max(0.6, 0.02 * text.length)));
    tl.exit(root, t + dur - 0.22);
    tl.add(dur);
    return { poster: t + dur - 0.23 };
  },
};

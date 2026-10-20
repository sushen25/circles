// @ts-check
/**
 * The explicit time-skip card: "Five weeks later" over a small label. The
 * same card `chat` plays for a digitless `when`; prefer this in new pieces.
 */
import { known, str } from './_kit.js';
import { skipCard } from './_skip.js';

/** @typedef {{ type: 'skip', line: string, sub?: string }} Props */

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'skip',
  // The card's rules live in _skip.js (shared with chat's implicit skip);
  // skipCard() injects them.
  css: '',
  schema(p) {
    const errs = [];
    known(p, ['type', 'line', 'sub'], errs);
    str(p, 'line', errs);
    str(p, 'sub', errs, true);
    if (typeof p.line === 'string' && p.line.length > 28) errs.push('`line` is long for the skip card; keep it to a few words ("Five weeks later")');
    if (typeof p.sub === 'string' && p.sub.length > 32) errs.push('`sub` is a short label (the chat title); keep it under 32 characters');
    return errs;
  },
  fixture: { type: 'skip', line: 'Five weeks later', sub: 'Uni lot' },
  scene(p, ctx, tl, root) {
    return skipCard(root, p.line, p.sub || '', tl);
  },
};

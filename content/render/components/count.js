// @ts-check
/**
 * Numbers paired with their meaning, one to three lines ("14 messages",
 * "0 plans"). Numbers roll up from 0 with ticks; the last line lands with a
 * thud and takes the accent.
 */
import { anim, el, esc, hide, known, rise, show, SPRING, str } from './_kit.js';

/** @typedef {{ n: string, of: string }} Line */
/** @typedef {{ type: 'count', lines: Line[] }} Props */

/** Most tick steps one number rolls through. */
const MAX_STEPS = 6;
const STEP = 0.075;

/**
 * The values a number shows on its way up: 0, a few steps, the number.
 * Non-numeric or zero: just the value (it pops instead).
 * @param {string} n
 */
export function rollValues(n) {
  if (!/^\d{1,5}$/.test(n)) return [n];
  const v = Number(n);
  if (v === 0) return [n];
  const steps = Math.min(v, MAX_STEPS);
  const out = ['0'];
  for (let k = 1; k <= steps; k++) out.push(String(Math.round((v * k) / steps)));
  out[out.length - 1] = n; // keep the writer's spelling (leading zeros, none expected)
  return out;
}

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'count',
  css: `
  .count { justify-content: center; gap: 44px; }
  .count .row { display: flex; align-items: baseline; gap: 40px; }
  .count .n { position: relative; flex: none; font-family: 'Newsreader', Georgia, serif; font-size: 250px; line-height: 0.9; letter-spacing: -0.03em; font-variant-numeric: tabular-nums lining-nums; color: var(--ink); }
  .count .row.last .n { color: var(--accent-dark); }
  .count .n .v { display: inline-block; opacity: 0; transform-origin: left bottom; }
  .count .n .v.mid { position: absolute; left: 0; bottom: 0; }
  .count .of { font-size: 60px; font-weight: 500; line-height: 1.15; color: var(--ink-2); opacity: 0; }
  .count .row.last .of { color: var(--ink); }

  body.still .scene.count { gap: 40px; }
  body.still .count .row { gap: 36px; }
  body.still .count .n { font-size: 224px; letter-spacing: -0.026em; }
  body.still .count .of { font-size: 54px; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'lines'], errs);
    if (!Array.isArray(p.lines) || p.lines.length < 1 || p.lines.length > 3) {
      errs.push('`lines` must be a list of 1 to 3 { n, of }');
      return errs;
    }
    p.lines.forEach((l, i) => {
      const at = `lines[${i}]`;
      if (!l || typeof l !== 'object') return errs.push(`${at} must be an object`);
      for (const k of Object.keys(l)) if (!['n', 'of'].includes(k)) errs.push(`${at}: unknown prop \`${k}\``);
      if (typeof l.n !== 'string' || !l.n.trim()) errs.push(`${at}.n is required (a string: "14", "Six")`);
      else if (l.n.length > 5) errs.push(`${at}.n is ${l.n.length} characters; a count is a short number (5 at most)`);
      if (typeof l.of !== 'string' || !l.of.trim()) errs.push(`${at}.of is required: a number is always paired with its meaning`);
      else if (l.of.length > 32) errs.push(`${at}.of is ${l.of.length} characters; keep the meaning under 32`);
    });
    return errs;
  },
  fixture: {
    type: 'count',
    lines: [
      { n: '6', of: 'friends' },
      { n: '41', of: 'messages since Sunday' },
      { n: '0', of: 'plans' },
    ],
  },
  scene(p, ctx, tl, root) {
    root.classList.add('count');
    const t = tl.now;
    tl.enter(root, t);
    let at = t + 0.05;
    p.lines.forEach((line, i) => {
      const last = i === p.lines.length - 1;
      const row = el('div', 'row' + (last ? ' last' : ''));
      const num = el('div', 'n');
      const of = el('div', 'of', esc(line.of));
      row.append(num, of);
      root.appendChild(row);

      const values = rollValues(line.n);
      // intermediate values sit over the final one, which sets the width
      const nodes = values.map((v, k) => el('span', 'v' + (k < values.length - 1 ? ' mid' : ''), esc(v)));
      num.append(...nodes);
      let land;
      if (values.length === 1) {
        land = at;
      } else {
        values.slice(0, -1).forEach((_, k) => {
          const on = at + k * STEP;
          show(nodes[k], on);
          hide(nodes[k], on + STEP);
          if (k > 0) tl.cue('tick', on);
        });
        land = at + (values.length - 1) * STEP;
      }
      const fin = nodes[nodes.length - 1];
      if (last) anim(fin, [{ opacity: 0, transform: 'scale(1.35)' }, { opacity: 1, transform: 'scale(1)' }], land, 0.2, SPRING);
      else if (values.length === 1) anim(fin, [{ opacity: 0, transform: 'translateY(30px) scale(.94)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], land, 0.28, SPRING);
      else show(fin, land);
      tl.cue(last ? 'thud' : values.length === 1 ? 'pop' : 'tick', land);
      rise(of, land + 0.08, 0.3);
      at = land + 0.4;
    });
    const dur = at - 0.4 + 0.08 + 0.3 + 0.7 - t;
    tl.exit(root, t + dur - 0.22);
    tl.add(dur);
    return { poster: t + dur - 0.23 };
  },
};

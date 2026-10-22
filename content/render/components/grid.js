// @ts-check
/** A row of days; the picked ones fill and tick, then a note lands. */
import { anim, EASE, el, esc, known, pop, SPRING, str, strList } from './_kit.js';

/** @typedef {{ type: 'grid', caption: string, days: string[], picked: string[], note?: string }} Props */

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'grid',
  css: `
  .grid { justify-content: center; }
  .grid .caption { font-size: 84px; margin-bottom: 64px; opacity: 0; }
  .grid .days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 16px; }
  .grid .day { position: relative; background: var(--surface); border: 3px solid var(--line); border-radius: 26px; height: 170px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; font-size: 36px; font-weight: 500; color: var(--ink-2); opacity: 0; }
  .grid .day .fill { position: absolute; inset: -3px; border-radius: 26px; background: var(--accent); opacity: 0; }
  .grid .day .dl { position: relative; }
  .grid .day .tick { position: relative; font-size: 46px; line-height: 1; color: #fff; opacity: 0; }
  .grid .note { margin-top: 64px; align-self: flex-start; display: inline-flex; align-items: center; gap: 18px; background: var(--support-soft); color: var(--support); border-radius: 999px; padding: 26px 40px; font-size: 42px; font-weight: 600; opacity: 0; }

  body.still .grid .caption { font-size: 64px; margin-bottom: 56px; }
  body.still .grid .days { gap: 14px; }
  body.still .grid .day { border: 2px solid var(--line); border-radius: 22px; height: 150px; font-size: 32px; }
  body.still .grid .day.picked { background: var(--accent); border-color: var(--accent); color: #fff; }
  body.still .grid .day .fill { display: none; }
  body.still .grid .day:not(.picked) .tick { display: none; }
  body.still .grid .day .tick { font-size: 40px; }
  body.still .grid .note { margin-top: 56px; padding: 22px 36px; font-size: 36px; font-weight: 500; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'caption', 'days', 'picked', 'note'], errs);
    str(p, 'caption', errs);
    strList(p, 'days', errs);
    strList(p, 'picked', errs);
    str(p, 'note', errs, true);
    if (Array.isArray(p.days) && Array.isArray(p.picked)) {
      for (const d of p.picked) if (!p.days.includes(d)) errs.push(`picked day "${d}" is not in \`days\``);
    }
    return errs;
  },
  fixture: {
    type: 'grid',
    caption: "Times we'd actually be up for",
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    picked: ['Thu', 'Sat'],
    note: '4 of 4 can make Thursday',
  },
  scene(p, ctx, tl, root) {
    root.classList.add('grid');
    const t = tl.now;
    const cap = el('div', 'display caption', esc(p.caption));
    const days = el('div', 'days');
    const cells = p.days.map((d) => {
      const c = el('div', 'day' + (p.picked.includes(d) ? ' picked' : ''));
      c.append(el('div', 'fill'), el('div', 'tick', '✓'), el('div', 'dl', esc(d)));
      days.appendChild(c);
      return c;
    });
    root.append(cap, days);
    const note = p.note ? el('div', 'note', '✓ ' + esc(p.note)) : null;
    if (note) root.appendChild(note);
    tl.enter(root, t);
    pop(cap, t + 0.02, 0.3);
    cells.forEach((c, i) => pop(c, t + 0.2 + i * 0.05, 0.26));
    let pk = 0;
    cells.forEach((c) => {
      if (!c.classList.contains('picked')) return;
      const at = t + 0.85 + pk * 0.18;
      anim(/** @type {Element} */ (c.querySelector('.fill')), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], at, 0.28, SPRING);
      anim(/** @type {Element} */ (c.querySelector('.tick')), [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], at + 0.05, 0.25, SPRING);
      anim(/** @type {Element} */ (c.querySelector('.dl')), [{ color: '#6C6156' }, { color: '#ffffff' }], at, 0.1, EASE);
      tl.cue('tick', at);
      pk++;
    });
    const noteAt = t + 0.85 + pk * 0.18 + 0.25;
    if (note) {
      pop(note, noteAt, 0.34);
      tl.cue('thud', noteAt);
    }
    const dur = noteAt - t + 1.5;
    tl.exit(root, t + dur - 0.22);
    tl.add(dur);
    return { poster: t + dur - 0.23 };
  },
};

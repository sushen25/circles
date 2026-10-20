// @ts-check
/**
 * A fortnight crossed out one person at a time until (almost) nothing is
 * left. The "before" of a story: no phone frame, no accent fills, strikes in
 * `--ink-3`. Each person's cross is its own layer, so a day two people are
 * busy on reads darker. Clear days left at the end go `--support-soft` and
 * the note lands.
 */
import { anim, el, esc, known, pop, rise, SPRING, str } from './_kit.js';

/**
 * @typedef {{ name: string, busy: number[] }} Person
 * @typedef {{ type: 'calendar', title?: string, start: number, month?: string, days?: 7 | 14,
 *   firstDow?: number, people: Person[], note?: string }} Props
 */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// small per-person tilt so stacked crosses read as more scribble, not one line
const TILT = [0, 6, -6, 11, -11, 3];

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'calendar',
  css: `
  .calendar { justify-content: center; }
  .calendar .title { font-size: 100px; margin-bottom: 52px; opacity: 0; }
  .calendar .who { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 60px; }
  .calendar .chip { background: var(--surface); border: 3px solid var(--line); border-radius: 999px; padding: 16px 34px; font-size: 38px; font-weight: 500; color: var(--ink-2); opacity: 0; }
  .calendar .range { margin-bottom: 18px; opacity: 0; }
  .calendar .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 16px; }
  .calendar .dow { font-size: 28px; font-weight: 600; letter-spacing: .05em; color: var(--ink-3); text-align: center; opacity: 0; }
  .calendar .d { position: relative; background: var(--surface); border: 3px solid var(--line); border-radius: 26px; height: 176px; display: flex; align-items: center; justify-content: center; opacity: 0; }
  .calendar .d .clear { position: absolute; inset: -3px; border-radius: 26px; background: var(--support-soft); opacity: 0; }
  .calendar .d .n { position: relative; font-size: 46px; font-weight: 500; color: var(--ink); }
  .calendar .d svg { position: absolute; inset: 22px 18px; width: calc(100% - 36px); height: calc(100% - 44px); overflow: visible; opacity: .55; }
  .calendar .d svg line { stroke: var(--ink-3); stroke-width: 10px; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
  .calendar .note { margin-top: 72px; font-size: 92px; opacity: 0; }

  body.still .calendar .title { font-size: 80px; margin-bottom: 44px; }
  body.still .calendar .who { gap: 14px; margin-bottom: 52px; }
  body.still .calendar .chip { border-width: 2px; padding: 14px 30px; font-size: 34px; }
  body.still .calendar .range { margin-bottom: 16px; font-size: 26px; }
  body.still .calendar .cal { gap: 14px; }
  body.still .calendar .dow { font-size: 25px; }
  body.still .calendar .d { border-width: 2px; border-radius: 22px; height: 156px; }
  body.still .calendar .d .clear { inset: -2px; border-radius: 22px; }
  body.still .calendar .d .n { font-size: 40px; }
  body.still .calendar .d svg { inset: 20px 16px; width: calc(100% - 32px); height: calc(100% - 40px); }
  body.still .calendar .d svg line { stroke-width: 9px; }
  body.still .calendar .note { margin-top: 60px; font-size: 76px; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'title', 'start', 'month', 'days', 'firstDow', 'people', 'note'], errs);
    str(p, 'title', errs, true);
    str(p, 'month', errs, true);
    str(p, 'note', errs, true);
    const start = p.start;
    const days = p.days ?? 14;
    const dow = p.firstDow ?? 1;
    const okStart = Number.isInteger(start) && start >= 1 && start <= 31;
    if (!okStart) errs.push('`start` must be a day of the month (1–31)');
    if (days !== 7 && days !== 14) errs.push('`days` must be 7 or 14');
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) errs.push('`firstDow` must be 0 (Sun) to 6 (Sat)');
    const last = okStart ? start + (days === 7 ? 7 : 14) - 1 : 0;
    if (okStart && last > 31) errs.push(`\`start\` ${start} plus ${days} days runs past the 31st; keep the window inside one month`);
    if (!Array.isArray(p.people) || p.people.length < 1 || p.people.length > 6) errs.push('`people` must list 1 to 6 people');
    (Array.isArray(p.people) ? p.people : []).forEach((/** @type {any} */ x, i) => {
      known(x, ['name', 'busy'], errs);
      if (typeof x?.name !== 'string' || !x.name.trim()) errs.push(`people[${i}].name is required`);
      if (!Array.isArray(x?.busy)) errs.push(`people[${i}].busy must be a list of day numbers`);
      else
        for (const d of x.busy) {
          if (!Number.isInteger(d)) errs.push(`people[${i}].busy has a non-number ${JSON.stringify(d)}`);
          else if (okStart && (d < start || d > last)) errs.push(`people[${i}].busy day ${d} is outside ${start}–${last}`);
        }
    });
    return errs;
  },
  fixture: {
    type: 'calendar',
    title: 'The next two weeks',
    start: 12,
    month: 'Oct',
    days: 14,
    firstDow: 1,
    people: [
      { name: 'Jess', busy: [12, 13, 17, 18, 24] },
      { name: 'Dev', busy: [14, 15, 19, 25] },
      { name: 'Sam', busy: [16, 20, 21, 18] },
      { name: 'Harriet', busy: [23, 17] },
    ],
    note: "Thu 22. That's it.",
  },
  scene(p, ctx, tl, root) {
    root.classList.add('calendar');
    const t = tl.now;
    const n = p.days === 7 ? 7 : 14;
    const lead = ((p.firstDow ?? 1) + 6) % 7; // empty cells before the start, Mon-first

    const title = p.title ? el('div', 'display title', esc(p.title)) : null;
    if (title) root.appendChild(title);
    const who = el('div', 'who');
    const chips = p.people.map((x) => who.appendChild(el('div', 'chip', esc(x.name))));
    root.appendChild(who);
    const range = p.month ? el('div', 'lbl range', `${p.start}–${p.start + n - 1} ${esc(p.month)}`) : null;
    if (range) root.appendChild(range);
    const cal = el('div', 'cal');
    const dows = DOW.map((d) => cal.appendChild(el('div', 'dow', d)));
    for (let i = 0; i < lead; i++) cal.appendChild(el('div'));
    /** @type {Map<number, HTMLElement>} */
    const cells = new Map();
    for (let i = 0; i < n; i++) {
      const c = el('div', 'd');
      c.append(el('div', 'clear'), el('div', 'n', String(p.start + i)));
      cal.appendChild(c);
      cells.set(p.start + i, c);
    }
    root.appendChild(cal);
    const note = p.note ? el('div', 'display note', esc(p.note)) : null;
    if (note) root.appendChild(note);

    tl.enter(root, t);
    if (title) pop(title, t + 0.02, 0.3);
    chips.forEach((c, i) => rise(c, t + 0.15 + i * 0.04, 0.24));
    if (range) rise(range, t + 0.2, 0.24);
    dows.forEach((d) => rise(d, t + 0.22, 0.24));
    [...cells.values()].forEach((c, i) => pop(c, t + 0.25 + i * 0.03, 0.26));

    let tt = t + 0.25 + n * 0.03 + 0.4;
    /** @type {Map<number, number>} */
    const crossed = new Map();
    p.people.forEach((x, pi) => {
      const chip = chips[pi];
      anim(chip, [{ background: '#FFFFFF', borderColor: '#EAE0D3', color: '#6C6156' }, { background: '#F6E5DC', borderColor: '#F6E5DC', color: '#A0431F' }], tt, 0.16);
      tl.cue('pop', tt);
      tt += 0.28;
      const busy = [...new Set(x.busy)].sort((a, b) => a - b);
      busy.forEach((d) => {
        const c = cells.get(d);
        if (!c) return;
        const k = crossed.get(d) ?? 0;
        crossed.set(d, k + 1);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.style.transform = `rotate(${TILT[k % TILT.length]}deg)`;
        svg.innerHTML =
          '<line x1="8" y1="8" x2="92" y2="92" pathLength="1" vector-effect="non-scaling-stroke"/>' +
          '<line x1="92" y1="8" x2="8" y2="92" pathLength="1" vector-effect="non-scaling-stroke"/>';
        c.appendChild(svg);
        const [a, b] = svg.querySelectorAll('line');
        anim(a, [{ strokeDashoffset: 1, opacity: 0 }, { opacity: 1, offset: 0.01 }, { strokeDashoffset: 0, opacity: 1 }], tt, 0.1);
        anim(b, [{ strokeDashoffset: 1, opacity: 0 }, { opacity: 1, offset: 0.01 }, { strokeDashoffset: 0, opacity: 1 }], tt + 0.06, 0.1);
        if (k === 0) anim(/** @type {Element} */ (c.querySelector('.n')), [{ color: '#221E19' }, { color: '#796D61' }], tt, 0.12);
        tl.cue('tick', tt);
        tt += 0.12;
      });
      tt += 0.12;
      anim(chip, [{ background: '#F6E5DC', borderColor: '#F6E5DC', color: '#A0431F' }, { background: '#FFFFFF', borderColor: '#EAE0D3', color: '#6C6156' }], tt, 0.2, undefined, 'forwards');
      tt += pi === p.people.length - 1 ? 0.2 : 0.35;
    });

    const clear = [...cells.entries()].filter(([d]) => !crossed.has(d));
    clear.forEach(([, c], i) => {
      anim(/** @type {Element} */ (c.querySelector('.clear')), [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)' }], tt + i * 0.06, 0.3, SPRING);
      anim(/** @type {Element} */ (c.querySelector('.n')), [{ color: '#221E19' }, { color: '#4F6B45' }], tt + i * 0.06, 0.15);
    });
    if (clear.length) tt += 0.3 + clear.length * 0.06;
    if (note) {
      pop(note, tt, 0.34);
      tl.cue('thud', tt);
      tt += 0.34;
    }
    const dur = tt - t + 1.2;
    tl.exit(root, t + dur - 0.22);
    tl.add(dur);
    return { poster: t + dur - 0.23 };
  },
};

// @ts-check
/**
 * The locked-in screen inside a phone: date, time, place, who is going.
 * Queue JSON: `{ "type": "screen", "screen": "locked", ... }`.
 */
import { anim, EASE_OUT, el, esc, known, pop, rise, SPRING, str, strList, tone } from './_kit.js';

/**
 * @typedef {{ type: 'screen', screen: 'locked', lead?: string, circle?: string, date?: string, time?: string,
 *   place?: string, area?: string, people?: string[], going?: string, quote?: string }} Props
 */

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'screen-locked',
  css: `
  .ph-lock .ph-body { gap: 22px; justify-content: center; }
  .ph-lock .ph-lbl { color: var(--support); }
  .ph-date { font-family: 'Newsreader', Georgia, serif; font-size: 72px; line-height: 1.05; letter-spacing: -0.018em; }
  .ph-time { font-family: 'Newsreader', Georgia, serif; font-size: 46px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .ph-place { font-size: 32px; font-weight: 600; margin-top: 6px; }
  .ph-place span { font-weight: 400; color: var(--ink-2); }
  .ph-av { display: flex; margin-top: 10px; }
  .ph-av .a { width: 76px; height: 76px; border-radius: 50%; background: var(--accent-soft); color: var(--accent-dark); border: 4px solid var(--ground); margin-right: -14px; display: flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 600; opacity: 0; }
  .ph-going { font-size: 30px; color: var(--ink-2); }
  .ph-you { margin-top: 10px; background: var(--support-soft); color: var(--support); border-radius: 22px; padding: 26px 30px; font-size: 30px; font-weight: 600; opacity: 0; }
  .ph-you span { display: block; font-weight: 400; font-size: 26px; margin-top: 4px; }
  .ph-quote { background: var(--surface); border: 2px solid var(--line); border-radius: 22px; padding: 24px 30px; font-size: 29px; line-height: 1.4; color: var(--ink-2); }

  body.still .ph-lock .ph-body { gap: 22px; }
  body.still .ph-date { font-size: 68px; }
  body.still .ph-time { font-size: 44px; }
  body.still .ph-place { font-size: 30px; margin-top: 0; }
  body.still .ph-av { margin-top: 8px; }
  body.still .ph-av .a { width: 72px; height: 72px; font-size: 28px; }
  body.still .ph-going { font-size: 28px; }
  body.still .ph-you { margin-top: 8px; padding: 24px 28px; font-size: 28px; }
  body.still .ph-you span { font-size: 24px; }
  body.still .ph-quote { padding: 22px 28px; font-size: 27px; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'screen', 'lead', 'circle', 'date', 'time', 'place', 'area', 'people', 'going', 'quote'], errs);
    if (p.screen !== 'locked') errs.push('`screen` must be "locked"');
    for (const k of ['lead', 'circle', 'date', 'time', 'place', 'area', 'going', 'quote']) str(p, k, errs, true);
    strList(p, 'people', errs, true);
    if (Array.isArray(p.people) && p.people.length > 8) errs.push('`people`: at most 8 avatars fit');
    return errs;
  },
  fixture: {
    type: 'screen',
    screen: 'locked',
    lead: 'Someone locks it in. Everyone gets this.',
    circle: 'Thursday crew',
    date: 'Thursday 17 September',
    time: '6:30–8:30 pm',
    place: "Marcus's place",
    area: 'Brunswick',
    people: ['Priya', 'Tom', 'Nina', 'Marcus'],
    going: '4 of 4 going',
  },
  scene(p, ctx, tl, root) {
    root.classList.add('screen');
    const t = tl.now;
    const lead = el('div', 'lead', esc(p.lead || 'Someone locks it in. Everyone gets this.'));
    const ph = el('div', 'phone ph-lock');
    ph.appendChild(el('div', 'ph-top', `<span>${esc(p.circle || 'Thursday crew')}</span>`));
    const body = el('div', 'ph-body');
    const items = [
      el('div', 'ph-lbl', 'Locked in'),
      el('div', 'ph-date', esc(p.date || 'Thursday 17 September')),
      el('div', 'ph-time', esc(p.time || '6:30–8:30 pm')),
    ];
    if (p.place) items.push(el('div', 'ph-place', `${esc(p.place)} <span>· ${esc(p.area || '')}</span>`));
    const av = el('div', 'ph-av');
    const people = p.people || ['Priya', 'Tom', 'Nina', 'Marcus'];
    people.forEach((n) => av.appendChild(el('div', 'a', esc(n[0]))));
    items.push(av);
    items.push(el('div', 'ph-going', esc(p.going || `${people.length} going · ${people.join(', ')}`)));
    const you = el('div', 'ph-you', `You're going<span>Tap below if that changes</span>`);
    items.push(you);
    if (p.quote) items.push(el('div', 'ph-quote', esc(p.quote)));
    items.forEach((n) => body.appendChild(n));
    const foot = el('div', 'ph-foot');
    foot.append(el('div', 'ph-btn sec', 'Add to calendar'));
    ph.append(body, foot);
    root.append(lead, ph);

    tl.enter(root, t);
    pop(lead, t + 0.05, 0.3);
    const phoneIn = [{ opacity: 0, transform: 'translateY(120px) scale(.96)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }];
    if (tone.calm) anim(ph, phoneIn, t + 0.15, 0.7, EASE_OUT);
    else anim(ph, phoneIn, t + 0.15, 0.5, SPRING);
    tl.cue('thud', t + 0.15);
    const avAt = items.indexOf(av);
    const head = items.slice(0, avAt); // label, date, time and, when given, the place
    head.forEach((n, i) => rise(n, t + 0.45 + i * 0.1, 0.3));
    const avStart = t + 0.45 + head.length * 0.1 + 0.05;
    av.querySelectorAll('.a').forEach((a, i) => {
      anim(a, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], avStart + i * 0.1, 0.26, SPRING);
      // calm: each mark lands one note higher
      tl.cue(tone.calm ? /** @type {any} */ (`note${Math.min(8, i + 1)}`) : 'pop', avStart + i * 0.1);
    });
    const goingAt = avStart + people.length * 0.1;
    rise(items[avAt + 1], goingAt, 0.3); // "4 of 4 going"
    const youAt = Math.max(t + 1.5, goingAt + 0.2);
    pop(you, youAt, 0.34);
    const quoteNode = items[items.indexOf(you) + 1];
    if (quoteNode) rise(quoteNode, youAt + 0.15, 0.3);
    tl.cue('send', youAt);
    const dur = 2.6;
    tl.exit(root, t + dur - 0.22);
    tl.add(dur);
    return { poster: t + dur - 0.23 };
  },
};

// @ts-check
/**
 * The guest's availability screen inside a phone: days get picked, the
 * answer rows fill in, "Send my times" is pressed and the "Sent" state
 * slides up. Queue JSON: `{ "type": "screen", "screen": "availability", ... }`.
 *
 * The still is the poster frame just before the press: calendar picked,
 * button not yet pressed. The video carries on to "Sent".
 */
import { anim, EASE, el, esc, known, pop, press, rise, show, hide, SPRING, str } from './_kit.js';

/**
 * @typedef {{ day: number, when?: string, label: string, time?: string }} Pick
 * @typedef {{ type: 'screen', screen: 'availability', lead?: string, plan?: string, title?: string, sub?: string,
 *   start?: number, picks?: Pick[], sentLine?: string, sentSub?: string }} Props
 */

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'screen-availability',
  css: `
  .ph-top .cnt { position: absolute; right: 44px; }
  .ph-dxl { font-family: 'Newsreader', Georgia, serif; font-size: 70px; line-height: 1.08; letter-spacing: -0.018em; }
  .ph-p { font-size: 28px; line-height: 1.45; color: var(--ink-2); }
  .ph-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; }
  .ph-cal .dow { font-size: 22px; font-weight: 600; color: var(--ink-3); text-align: center; letter-spacing: .05em; padding-bottom: 6px; }
  .ph-cal .d { position: relative; height: 92px; border-radius: 20px; background: var(--surface); border: 2px solid var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 32px; font-weight: 500; color: var(--ink); }
  .ph-cal .d .fill { position: absolute; inset: -2px; border-radius: 20px; background: var(--accent); opacity: 0; }
  .ph-cal .d .n { position: relative; }
  .ph-cal .d .tag { position: absolute; left: 0; right: 0; bottom: 6px; text-align: center; font-size: 18px; font-weight: 600; color: #fff; opacity: 0; }
  .ph-ans { display: flex; flex-direction: column; }
  .ph-ans .row { display: flex; justify-content: space-between; font-size: 29px; padding: 16px 0; border-top: 2px solid var(--line-soft); opacity: 0; }
  .ph-ans .row span:last-child { color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .ph-sent { position: absolute; inset: 0; background: var(--ground); display: flex; flex-direction: column; justify-content: center; padding: 60px 60px; gap: 28px; opacity: 0; }
  .ph-sent .big { font-family: 'Newsreader', Georgia, serif; font-size: 78px; line-height: 1.06; letter-spacing: -0.018em; }
  .ph-sent .ok { align-self: flex-start; background: var(--support-soft); color: var(--support); border-radius: 999px; padding: 18px 30px; font-size: 30px; font-weight: 600; }
  .ph-sent .fine { font-size: 28px; color: var(--ink-2); line-height: 1.45; }

  body.still .ph-top .cnt { right: 42px; }
  body.still .ph-dxl { font-size: 66px; }
  body.still .ph-p { font-size: 27px; }
  body.still .ph-cal .dow { font-size: 21px; }
  body.still .ph-cal .d { height: 88px; font-size: 30px; }
  body.still .ph-cal .d.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  /* the still draws picked days with .on, as the old still did: the fill's
     rounded edge over the border antialiases a shade differently */
  body.still .ph-cal .d .fill { display: none; }
  body.still .ph-cal .d .tag { font-size: 17px; }
  body.still .ph-cal .d .tag:empty { display: none; }
  body.still .ph-ans .row { font-size: 28px; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'screen', 'lead', 'plan', 'title', 'sub', 'start', 'picks', 'sentLine', 'sentSub'], errs);
    if (p.screen !== 'availability') errs.push('`screen` must be "availability"');
    for (const k of ['lead', 'plan', 'title', 'sub', 'sentLine', 'sentSub']) str(p, k, errs, true);
    const start = p.start ?? 14;
    if (typeof start !== 'number' || !Number.isInteger(start) || start < 1 || start > 31) errs.push('`start` must be a day of the month');
    if (p.picks !== undefined && !Array.isArray(p.picks)) errs.push('`picks` must be a list');
    (Array.isArray(p.picks) ? p.picks : []).forEach((/** @type {any} */ k, i) => {
      if (typeof k?.day !== 'number') errs.push(`picks[${i}].day must be a number`);
      else if (k.day < start || k.day >= start + 14) errs.push(`picks[${i}].day ${k.day} is outside ${start}–${start + 13}`);
      if (typeof k?.label !== 'string') errs.push(`picks[${i}].label is required`);
    });
    return errs;
  },
  fixture: {
    type: 'screen',
    screen: 'availability',
    lead: 'What the link opens. No app, no account.',
    plan: 'Thursday crew · next 14 days',
    start: 14,
    picks: [
      { day: 17, when: 'Eve', label: 'Thu 17 Sep', time: '6:30–10:30 pm' },
      { day: 19, when: 'Arvo', label: 'Sat 19 Sep', time: '2–5 pm' },
      { day: 24, when: 'Eve', label: 'Thu 24 Sep', time: '6:30–10:30 pm' },
    ],
    sentLine: 'Done. Your times are in.',
    sentSub: 'Your friends see who can make each suggested time, never your calendar.',
  },
  scene(p, ctx, tl, root) {
    root.classList.add('screen');
    const t = tl.now;
    const lead = el('div', 'lead', esc(p.lead || 'What the link opens. No app, no account.'));
    const ph = el('div', 'phone');
    const top = el('div', 'ph-top', `<span>${esc(p.plan || 'Catch up · next 14 days')}</span>`);
    ph.appendChild(top);
    const body = el('div', 'ph-body');
    body.append(el('div', 'ph-dxl', esc(p.title || "Times I'd actually be up for")));
    body.append(el('div', 'ph-p', esc(p.sub || 'Catch-ups run about 2 hours. Replies close Tue 6 pm.')));
    const cal = el('div', 'ph-cal');
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => cal.appendChild(el('div', 'dow', d)));
    const start = p.start || 14;
    /** @type {HTMLElement[]} */
    const cells = [];
    for (let i = 0; i < 14; i++) {
      const c = el('div', 'd');
      c.append(el('div', 'fill'), el('div', 'n', String(start + i)), el('div', 'tag', ''));
      cal.appendChild(c);
      cells.push(c);
    }
    body.appendChild(cal);
    body.appendChild(el('div', 'ph-lbl', 'My answer'));
    const ans = el('div', 'ph-ans');
    body.appendChild(ans);
    const foot = el('div', 'ph-foot');
    const btn = el('div', 'ph-btn pri', 'Send my times');
    foot.append(btn, el('div', 'ph-fine', "Your friends will see who can make each suggested time. They won't see your calendar, or your whole availability with your name on it."));
    const sent = el('div', 'ph-sent');
    sent.append(el('div', 'ok', '✓ Sent'), el('div', 'big', esc(p.sentLine || 'Done. That took about 20 seconds.')), el('div', 'fine', esc(p.sentSub || "We'll tell you when it's locked in.")));
    ph.append(body, foot, sent);
    root.append(lead, ph);

    tl.enter(root, t);
    pop(lead, t + 0.05, 0.3);
    anim(ph, [{ opacity: 0, transform: 'translateY(120px) scale(.96)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], t + 0.15, 0.5, SPRING);
    tl.cue('thud', t + 0.15);
    let tt = t + 0.9;
    const picks = p.picks || [];
    let counter = el('span', 'cnt', '0 of 14 days');
    top.appendChild(counter);
    picks.forEach((k, i) => {
      const c = cells[k.day - start];
      if (!c) return;
      c.classList.add('on'); // still metrics only; the video animates .fill
      press(c, tt);
      anim(/** @type {Element} */ (c.querySelector('.fill')), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], tt + 0.05, 0.26, SPRING);
      anim(/** @type {Element} */ (c.querySelector('.n')), [{ color: '#221E19' }, { color: '#ffffff' }], tt + 0.05, 0.1, EASE);
      const tag = /** @type {HTMLElement} */ (c.querySelector('.tag'));
      tag.textContent = k.when || 'Eve';
      show(tag, tt + 0.12, 0.15);
      const row = el('div', 'row', `<span>${esc(k.label)}</span><span>${esc(k.time || '6:30–10:30 pm')}</span>`);
      ans.appendChild(row);
      rise(row, tt + 0.12, 0.25);
      tl.cue('tick', tt);
      hide(counter, tt + 0.1);
      counter = el('span', 'cnt', `${i + 1} of 14 days`);
      top.appendChild(counter);
      show(counter, tt + 0.1);
      tt += 0.5;
    });
    tt += 0.4;
    const pressAt = tt;
    press(btn, tt);
    tl.cue('send', tt);
    anim(sent, [{ opacity: 0, transform: 'translateY(60px)' }, { opacity: 1, transform: 'translateY(0)' }], tt + 0.25, 0.35, SPRING);
    tt += 1.5;
    tl.exit(root, tt - 0.22);
    tl.now = tt;
    return { poster: pressAt - 0.01 };
  },
};

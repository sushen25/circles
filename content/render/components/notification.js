// @ts-check
/**
 * Banners piling up across time: drift shown without a single reply. Each
 * banner lands at the top of the stack and pushes the earlier ones down; the
 * time on each banner is the joke, and the optional `when` names the span.
 *
 * Our own card language (the chat bubble and link card's register), never a
 * lookalike of a phone's lock screen or a messenger's banner.
 */
import { anim, EASE, EASE_IN_OUT, el, esc, GAP, glide, known, naturalHeight, reserve, rise, str } from './_kit.js';

/**
 * @typedef {{ group: string, from: string, text: string, time: string }} Item
 * @typedef {{ type: 'notification', when?: string, items: Item[] }} Props
 */

const MAX_TEXT = 60;

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'notification',
  css: `
  .notification { justify-content: flex-start; }
  .notification .span { font-family: 'Newsreader', Georgia, serif; font-size: 96px; letter-spacing: -0.02em; line-height: 1.04; color: var(--accent-dark); opacity: 0; margin: 20px 0 30px; }
  .notification .stack { display: flex; flex-direction: column; align-items: stretch; }
  .notification .nb { opacity: 0; max-height: 0; margin-top: 0; overflow: visible; transform-origin: center top; }
  .notification .nb .in { background: var(--surface); border: 3px solid var(--line); border-radius: 40px; padding: 30px 40px 34px; box-shadow: 0 24px 48px -36px rgba(74,55,38,.35); }
  .notification .nb .lbl { font-size: 30px; margin-bottom: 12px; display: flex; gap: 14px; }
  .notification .nb .lbl .tm { color: var(--accent-dark); }
  .notification .nb .tx { font-size: 48px; line-height: 1.25; color: var(--ink); }
  .notification .nb .tx b { font-weight: 600; }

  /* still: every banner at rest, the carousel metrics */
  body.still .scene.notification { padding: 220px 120px 380px 120px !important; justify-content: center; }
  body.still .notification .span { font-size: 88px; letter-spacing: -0.018em; line-height: 1.08; margin: 10px 0 26px; }
  body.still .notification .stack { gap: 22px; }
  body.still .notification .nb { max-height: none !important; margin-top: 0 !important; }
  body.still .notification .nb .in { border-width: 2px; border-radius: 36px; padding: 26px 34px 30px; box-shadow: none; }
  body.still .notification .nb .lbl { font-size: 27px; letter-spacing: 0.07em; margin-bottom: 10px; }
  body.still .notification .nb .tx { font-size: 44px; line-height: 1.3; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'when', 'items'], errs);
    str(p, 'when', errs, true);
    if (!Array.isArray(p.items) || p.items.length === 0) {
      errs.push('`items` must be a non-empty list');
      return errs;
    }
    if (p.items.length < 2 || p.items.length > 6) errs.push('`items` takes 2 to 6 banners');
    p.items.forEach((m, i) => {
      const at = `items[${i}]`;
      if (!m || typeof m !== 'object') return errs.push(`${at} must be an object`);
      for (const k of ['group', 'from', 'text', 'time']) {
        if (typeof m[k] !== 'string' || !m[k].trim()) errs.push(`${at}.${k} is required`);
      }
      if (typeof m.text === 'string' && m.text.length >= MAX_TEXT) errs.push(`${at}.text must be under ${MAX_TEXT} characters`);
      for (const k of Object.keys(m)) if (!['group', 'from', 'text', 'time'].includes(k)) errs.push(`${at}: unknown prop \`${k}\``);
    });
    return errs;
  },
  fixture: {
    type: 'notification',
    when: 'Three weeks',
    items: [
      { group: 'Thursday crew', from: 'Tom', text: 'anyone?', time: 'Mon 9:12 pm' },
      { group: 'Thursday crew', from: 'Tom', text: 'pub fri?', time: 'Thu 6:40 pm' },
      { group: 'Thursday crew', from: 'Tom', text: 'ok next week then', time: 'Sat 11:05 am' },
    ],
  },
  scene(p, ctx, tl, root) {
    root.classList.add('notification');
    // The stack grows downward from a fixed top, so start it where the full
    // pile ends up centred in the safe area (no dead half-frame for 2–3 items).
    const est = (p.when ? 150 : 0) + p.items.length * 210;
    root.style.paddingTop = `${Math.max(200, Math.round(880 - est / 2))}px`;
    const t0 = tl.now;
    tl.enter(root, t0);
    if (p.when) {
      const span = el('div', 'span', esc(p.when));
      root.appendChild(span);
      rise(span, t0 + 0.05, 0.32);
    }
    const stack = el('div', 'stack');
    root.appendChild(stack);
    tl.add(p.when ? 0.45 : 0.2);

    /** @type {HTMLElement[]} */
    const landed = [];
    p.items.forEach((m, k) => {
      const last = k === p.items.length - 1;
      const t = tl.now;
      const node = el('div', 'nb');
      // the slot carries no padding or border, so a banner that has not arrived takes no space
      const card = el('div', 'in');
      card.append(
        el('div', 'lbl', `<span>${esc(m.group)}</span><span>·</span><span class="tm">${esc(m.time)}</span>`),
        el('div', 'tx', `<b>${esc(m.from)}:</b> ${esc(m.text)}`),
      );
      node.append(card);
      // newest first: the new banner takes the top and pushes the rest down
      stack.insertBefore(node, stack.firstChild);
      const h = naturalHeight(node);
      reserve(node, t, h);
      // the new banner appears in its place at the top; the earlier ones slide down to make room
      anim(node, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'scale(1)' }], t, 0.3);
      for (const older of landed) glide(older, t, -(h + GAP));
      tl.cue('pop', t);
      // the banner just pushed down steps back: a small give, and its message greys
      const prev = landed[landed.length - 1];
      if (prev) {
        anim(prev, [{ transform: 'scale(1)' }, { transform: 'scale(.985)' }, { transform: 'scale(1)' }], t + 0.02, 0.3, EASE, 'none', 'add');
        anim(/** @type {Element} */ (prev.querySelector('.tx')), [{ color: '#221E19' }, { color: '#6C6156' }], t + 0.05, 0.3, EASE, 'forwards');
      }
      landed.push(node);
      // 0.9–1.3 s a banner, longer text reads longer; the last lingers
      const step = Math.min(1.3, 0.9 + 0.02 * m.text.length);
      tl.add(last ? 0.3 + 1.0 + 0.02 * m.text.length : step);
    });
    const end = tl.now;
    anim(stack, [{ transform: 'scale(1)' }, { transform: 'scale(1.015)' }], end - 1.2, 1.4, EASE_IN_OUT);
    tl.exit(root, end - 0.22);
    return { poster: end - 0.23 };
  },
};

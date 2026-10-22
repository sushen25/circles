// @ts-check
/**
 * The group-chat poll where every option gets one vote. A chat head, then one
 * poll card from `asked` (from-label above it like a message; inside, the
 * question as the heading), in Wenna's own styling: full-width option rows
 * whose fill grows from the left as votes land one at a time, interleaved
 * across options, each voter arriving as a first-name chip in the row (names,
 * not counts). The leader, or every row tied for the lead, settles into the
 * accent. Optional trailing messages arrive behind typing bubbles, the same
 * mechanic as chat.
 */
import { anim, contentHeight, EASE, EASE_IN_OUT, el, esc, GAP, glide, known, naturalHeight, pop, reserve, rise, SPRING, str, unreserve } from './_kit.js';

/**
 * @typedef {{ label: string, votes: string[] }} Option
 * @typedef {{ from: string, text: string }} Message
 * @typedef {{ type: 'poll', title: string, when?: string, asked: string, question: string, options: Option[], after?: Message[] }} Props
 */

const VOTE_GAP = 0.35;

/**
 * Votes in landing order: round-robin across options so the spread shows
 * (thu, fri, sat, thu), not one option filling up at a time.
 * @param {Option[]} options
 */
function landingOrder(options) {
  /** @type {{ o: number, v: number }[]} */
  const out = [];
  const most = Math.max(0, ...options.map((o) => o.votes.length));
  for (let v = 0; v < most; v++) options.forEach((o, i) => { if (v < o.votes.length) out.push({ o: i, v }); });
  return out;
}

/** Typing dots, then the message; mirrors chat.js. @returns {HTMLElement} */
function typingNode(/** @type {boolean} */ mine) {
  const typing = el('div', 'typing' + (mine ? ' me' : ''));
  typing.appendChild(el('div', 'bubble', '<span></span><span></span><span></span>'));
  typing.querySelectorAll('span').forEach((d, i) =>
    d.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }],
      { duration: 500, delay: i * 120, iterations: Infinity, easing: 'ease-in-out' }));
  return typing;
}

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'poll',
  css: `
  .poll { justify-content: flex-end; padding-bottom: 520px; }
  .poll .head { position: absolute; top: 200px; left: 100px; right: 100px; display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid var(--line); padding-bottom: 28px; }
  .poll .title { font-size: 44px; font-weight: 600; }
  .poll .when { font-family: 'Newsreader', Georgia, serif; font-size: 42px; color: var(--ink-2); }
  .poll .stream { height: 1080px; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 120px); mask-image: linear-gradient(to bottom, transparent 0, #000 120px); }
  .poll .from { font-size: 28px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 10px 30px; }
  .poll .msg { max-width: 820px; opacity: 0; transform-origin: left bottom; max-height: 0; margin-top: 0; overflow: visible; }
  .poll .msg .bubble { background: var(--surface); border: 3px solid var(--line); border-radius: 40px; padding: 30px 40px; font-size: 54px; line-height: 1.25; }
  .poll .msg.me { align-self: flex-end; transform-origin: right bottom; }
  .poll .msg.me .from, .poll .pcard.me .from { text-align: right; margin-right: 30px; }
  .poll .msg.me .bubble { background: var(--accent); border-color: var(--accent); color: #fff; }
  .poll .typing { opacity: 0; transform-origin: left bottom; max-height: 0; margin-top: 0; }
  .poll .typing.me { align-self: flex-end; transform-origin: right bottom; }
  .poll .typing .bubble { display: inline-flex; gap: 14px; padding: 40px 44px; background: var(--surface); border: 3px solid var(--line); border-radius: 40px; }
  .poll .typing.me .bubble { background: var(--accent-soft); border-color: var(--accent-soft); }
  .poll .typing .bubble span { width: 20px; height: 20px; border-radius: 50%; background: var(--ink-3); opacity: 0.5; }

  /* the card: one message from \`asked\`, question as its heading */
  .poll .pcard { width: 860px; opacity: 0; max-height: 0; margin-top: 0; overflow: visible; transform-origin: left top; }
  .poll .pcard.me { align-self: flex-end; transform-origin: right top; }
  .poll .pcard .in { background: var(--surface); border: 3px solid var(--line); border-radius: 40px; padding: 34px 32px 32px; }
  .poll .pcard .lbl { font-size: 26px; margin: 0 0 8px 8px; }
  .poll .pcard .q { font-size: 48px; font-weight: 600; line-height: 1.2; color: var(--ink); margin: 0 0 28px 8px; text-wrap: balance; }
  .poll .pcard .opts { display: flex; flex-direction: column; gap: 14px; }
  .poll .pcard .orow { position: relative; min-height: 96px; border-radius: 24px; background: var(--ground); border: 2px solid var(--line); overflow: hidden; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 10px 14px 10px 30px; opacity: 0; }
  .poll .pcard .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--line-soft); }
  .poll .pcard .ol { position: relative; font-size: 40px; font-weight: 600; line-height: 1; color: var(--ink); white-space: nowrap; }
  .poll .pcard .chips { position: relative; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; max-width: 560px; }
  .poll .pcard .chip { height: 60px; padding: 0 22px; border-radius: 30px; background: var(--surface); border: 2px solid var(--line); display: flex; align-items: center; font-size: 28px; font-weight: 500; color: var(--ink); opacity: 0; }
  .poll .pcard .chip.mine { color: var(--accent-dark); font-weight: 600; }

  /* still: final state, the chat carousel metrics */
  body.still .scene.poll { padding: 220px 120px 520px 120px; }
  body.still .scene.poll > .chrome { display: flex; }
  body.still .poll .head { top: 220px; left: 120px; right: 120px; border-bottom: 2px solid var(--line); }
  body.still .poll .title { font-size: 40px; }
  body.still .poll .when { font-size: 40px; font-variant-numeric: tabular-nums; }
  body.still .poll .stream { height: auto; max-height: 1040px; gap: 26px; -webkit-mask-image: none; mask-image: none; transform: none !important; }
  body.still .poll .stream.overflows { -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 120px); mask-image: linear-gradient(to bottom, transparent 0, #000 120px); }
  body.still .poll .typing { display: none !important; }
  body.still .poll .from { font-size: 26px; letter-spacing: 0.07em; margin: 0 0 8px 28px; }
  body.still .poll .msg.me .from, body.still .poll .pcard.me .from { margin-right: 28px; }
  body.still .poll .msg { max-width: 780px; max-height: none !important; margin-top: 0 !important; }
  body.still .poll .msg .bubble { border-width: 2px; border-radius: 36px; padding: 26px 34px; font-size: 44px; line-height: 1.3; }
  body.still .poll .pcard { width: 840px; max-height: none !important; margin-top: 0 !important; }
  body.still .poll .pcard .in { border-width: 2px; border-radius: 36px; padding: 30px 28px 28px; }
  body.still .poll .pcard .lbl { font-size: 24px; letter-spacing: 0.07em; }
  body.still .poll .pcard .q { font-size: 42px; margin-bottom: 24px; }
  body.still .poll .pcard .opts { gap: 12px; }
  body.still .poll .pcard .orow { min-height: 88px; border-radius: 22px; padding: 9px 12px 9px 26px; }
  body.still .poll .pcard .ol { font-size: 36px; }
  body.still .poll .pcard .chip { height: 54px; padding: 0 20px; border-radius: 27px; font-size: 26px; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'title', 'when', 'asked', 'question', 'options', 'after'], errs);
    str(p, 'title', errs);
    str(p, 'when', errs, true);
    str(p, 'asked', errs);
    str(p, 'question', errs);
    if (typeof p.question === 'string' && p.question.length >= 40) errs.push('`question` must be under 40 characters');
    if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > 6) {
      errs.push('`options` must be a list of 2 to 6 options');
    } else {
      let total = 0;
      p.options.forEach((o, i) => {
        const at = `options[${i}]`;
        if (!o || typeof o !== 'object') return errs.push(`${at} must be an object`);
        for (const k of Object.keys(o)) if (!['label', 'votes'].includes(k)) errs.push(`${at}: unknown prop \`${k}\``);
        if (typeof o.label !== 'string' || !o.label.trim()) errs.push(`${at}.label is required`);
        else if (o.label.length >= 12) errs.push(`${at}.label must be under 12 characters`);
        if (!Array.isArray(o.votes) || o.votes.some((/** @type {unknown} */ v) => typeof v !== 'string' || !v.trim())) {
          errs.push(`${at}.votes must be a list of first names`);
          return;
        }
        if (new Set(o.votes).size !== o.votes.length) errs.push(`${at}.votes names someone twice`);
        total += o.votes.length;
      });
      if (total > 8) errs.push(`at most 8 votes in total (found ${total})`);
    }
    if (p.after !== undefined) {
      if (!Array.isArray(p.after) || p.after.length > 2) errs.push('`after` must be a list of at most 2 messages');
      else p.after.forEach((/** @type {any} */ m, /** @type {number} */ i) => {
        const at = `after[${i}]`;
        if (!m || typeof m !== 'object') return errs.push(`${at} must be an object`);
        for (const k of Object.keys(m)) if (!['from', 'text'].includes(k)) errs.push(`${at}: unknown prop \`${k}\``);
        if (typeof m.from !== 'string' || !m.from.trim()) errs.push(`${at}.from is required`);
        if (typeof m.text !== 'string' || !m.text.trim()) errs.push(`${at}.text is required`);
        else if (m.text.length >= 60) errs.push(`${at}.text must be under 60 characters`);
      });
    }
    return errs;
  },
  fixture: {
    type: 'poll',
    title: 'Thursday crew',
    when: 'Sun 7:42 pm',
    asked: 'Tom',
    question: "when's everyone free",
    options: [
      { label: 'thu', votes: ['Tom', 'Jess'] },
      { label: 'fri', votes: ['Dev'] },
      { label: 'sat', votes: ['Sam'] },
      { label: 'sun', votes: [] },
    ],
    after: [
      { from: 'Tom', text: 'ok so… nobody' },
      { from: 'Priya', text: 'i could do sun' },
    ],
  },
  scene(p, ctx, tl, root) {
    const me = ctx.me;
    root.classList.add('poll');
    const head = el('div', 'head');
    head.append(el('div', 'title', esc(p.title)), el('div', 'when', esc(p.when || '')));
    const stream = el('div', 'stream');
    root.append(head, stream);
    tl.enter(root);
    pop(head, tl.now + 0.02, 0.28);
    tl.add(0.3);

    // the card, sent by `asked`: from-label, "Poll", the question, the rows
    const mine = p.asked === me;
    const most = Math.max(...p.options.map((o) => o.votes.length));
    const card = el('div', 'pcard' + (mine ? ' me' : ''));
    card.appendChild(el('div', 'from', esc(p.asked)));
    const inner = el('div', 'in');
    inner.append(el('div', 'lbl', 'Poll'), el('div', 'q', esc(p.question)));
    const opts = el('div', 'opts');
    const rows = p.options.map((o) => {
      const row = el('div', 'orow');
      const fill = el('div', 'fill');
      const label = el('div', 'ol', esc(o.label));
      const chips = el('div', 'chips');
      const pills = o.votes.map((v) => {
        const c = el('span', 'chip' + (v === me ? ' mine' : ''), esc(v));
        chips.appendChild(c);
        return c;
      });
      row.append(fill, label, chips);
      opts.appendChild(row);
      return { row, fill, label, pills, lead: most > 0 && o.votes.length === most };
    });
    inner.appendChild(opts);
    card.appendChild(inner);
    stream.appendChild(card);
    const ct = tl.now;
    reserve(card, ct, naturalHeight(card));
    anim(card, [{ opacity: 0, transform: 'translateY(40px) scale(.92)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], ct, 0.34, SPRING);
    tl.cue(mine ? 'send' : 'pop', ct);
    rows.forEach((r, i) => rise(r.row, ct + 0.14 + i * 0.06, 0.26));
    tl.add(0.45 + 0.06 * rows.length + 0.02 * p.question.length);

    // votes, interleaved across options; fill is votes over the leader's
    const counts = p.options.map(() => 0);
    const order = landingOrder(p.options);
    order.forEach(({ o, v }, k) => {
      const at = tl.now + k * VOTE_GAP;
      const r = rows[o];
      const from = (counts[o] / most) * 100;
      counts[o]++;
      const to = (counts[o] / most) * 100;
      anim(r.fill, [{ width: `${from}%` }, { width: `${to}%` }], at, 0.32, SPRING);
      anim(r.pills[v], [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], at + 0.04, 0.28, SPRING);
      tl.cue('tick', at);
    });
    // the tally is in: the leader, or every row tied for the lead, takes the accent
    const settle = tl.now + Math.max(0, order.length - 1) * VOTE_GAP + 0.3;
    rows.filter((r) => r.lead).forEach((r) => {
      anim(r.fill, [{ background: 'var(--line-soft)' }, { background: 'var(--accent-soft)' }], settle, 0.25, EASE);
      anim(r.label, [{ color: 'var(--ink)' }, { color: 'var(--accent-dark)' }], settle, 0.25, EASE);
    });
    tl.add(Math.max(0, order.length - 1) * VOTE_GAP + 0.65);

    // trailing messages, with typing, as chat does
    (p.after || []).forEach((m) => {
      const isMe = m.from === me;
      const typeFor = 0.35;
      const typing = typingNode(isMe);
      stream.appendChild(typing);
      const typingH = naturalHeight(typing);
      reserve(typing, tl.now, typingH);
      pop(typing, tl.now, 0.2);
      glide(stream, tl.now, typingH + GAP);
      tl.add(typeFor);
      const t = tl.now;
      const node = el('div', 'msg' + (isMe ? ' me' : ''));
      // the card sits between, so the name always shows again
      node.appendChild(el('div', 'from', esc(m.from)));
      node.appendChild(el('div', 'bubble', esc(m.text)));
      stream.insertBefore(node, typing);
      const nodeH = naturalHeight(node);
      // the typing bubble hands its slot to the message: the stack moves once, by the difference
      anim(typing, [{ opacity: 1 }, { opacity: 0 }], t, 0.01, 'step-start', 'forwards');
      unreserve(typing, t, typingH);
      reserve(node, t, nodeH);
      pop(node, t, 0.3);
      glide(stream, t, nodeH - typingH);
      tl.cue(isMe ? 'send' : 'pop', t);
      tl.add(0.35 + 0.02 * m.text.length);
    });

    // still: a poll too long for its slide fades out under its header instead of running into it
    if (document.body.classList.contains('still') && contentHeight(stream) > stream.clientHeight) stream.classList.add('overflows');
    tl.add(1.0);
    const end = tl.now;
    anim(stream, [{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }], end - 2, 2.2, EASE_IN_OUT, 'both', 'add');
    tl.exit(root, end - 0.22);
    return { poster: end - 0.23 };
  },
};

// @ts-check
/**
 * A one-on-one chat beside the group chat: what two people say to each other
 * that they do not say to the group. Same message mechanics as `chat`
 * (typing bubbles, pops, `me` right-aligned in the accent, pace, cues), but
 * the chrome reads as a side room: both names in the head, a narrower column,
 * and an inset panel tinted `--accent-soft`. No link cards.
 *
 * The message loop is copied from chat.js rather than shared, so dm carries
 * its own styles and renders correctly in a piece that has no `chat` slide.
 * A `when` with no digits plays the time-skip card first, like chat.
 */
import { anim, el, esc, GAP, glide, known, naturalHeight, pop, reserve, sceneBefore, str, unreserve } from './_kit.js';
import { skipCard } from './_skip.js';
import { skipsTime } from './chat.js';

/**
 * @typedef {{ from: string, text: string }} Message
 * @typedef {{ type: 'dm', a: string, b: string, when?: string, pace?: 'slow' | 'normal' | 'fast', messages: Message[] }} Props
 */

/** Message limits: a dm is a short exchange. */
const MIN = 3;
const MAX = 7;
const CHARS = 60;

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'dm',
  css: `
  .dm { justify-content: flex-end; padding: 200px 150px 620px; }
  .dm .room { position: absolute; top: 150px; left: 70px; right: 70px; bottom: 540px; border-radius: 64px; background: var(--accent-soft); opacity: .72; }
  .dm .head { position: absolute; top: 200px; left: 150px; right: 150px; display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid rgba(194, 84, 47, .18); padding-bottom: 26px; }
  .dm .title { font-size: 44px; font-weight: 600; color: var(--ink); }
  .dm .title .amp { color: var(--accent-dark); font-weight: 500; padding: 0 .12em; }
  .dm .when { font-family: 'Newsreader', Georgia, serif; font-size: 42px; color: var(--ink-2); }
  .dm .stream { position: relative; height: 900px; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 120px); mask-image: linear-gradient(to bottom, transparent 0, #000 120px); }
  .dm .msg { max-width: 700px; opacity: 0; transform-origin: left bottom; max-height: 0; margin-top: 0; overflow: visible; }
  .dm .msg .from { font-size: 28px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 10px 30px; }
  .dm .msg .bubble { background: var(--surface); border: 3px solid var(--surface); border-radius: 40px; padding: 30px 40px; font-size: 54px; line-height: 1.25; }
  .dm .msg.me { align-self: flex-end; transform-origin: right bottom; }
  .dm .msg.me .from { text-align: right; margin-right: 30px; }
  .dm .msg.me .bubble { background: var(--accent); border-color: var(--accent); color: #fff; }
  .dm .typing { opacity: 0; transform-origin: left bottom; max-height: 0; margin-top: 0; }
  .dm .typing.me { align-self: flex-end; transform-origin: right bottom; }
  .dm .typing .bubble { display: inline-flex; gap: 14px; padding: 40px 44px; background: var(--surface); border: 3px solid var(--surface); border-radius: 40px; }
  .dm .typing.me .bubble { background: #EBC9B8; border-color: #EBC9B8; }
  .dm .typing .bubble span { width: 20px; height: 20px; border-radius: 50%; background: var(--ink-3); opacity: 0.5; }

  /* still: every message at rest, chat's still metrics in the narrower room */
  body.still .dm { padding: 220px 170px 520px; }
  body.still .dm .room { top: 170px; left: 90px; right: 90px; bottom: 470px; }
  body.still .dm .head { top: 220px; left: 170px; right: 170px; border-bottom-width: 2px; }
  body.still .dm .title { font-size: 40px; }
  body.still .dm .when { font-size: 40px; font-variant-numeric: tabular-nums; }
  body.still .dm .stream { height: auto; max-height: 1060px; gap: 26px; -webkit-mask-image: none; mask-image: none; transform: none !important; }
  body.still .dm .typing { display: none !important; }
  body.still .dm .msg { max-width: 660px; max-height: none !important; margin-top: 0 !important; }
  body.still .dm .msg.same { margin-top: -14px !important; }
  body.still .dm .msg .from { font-size: 26px; letter-spacing: 0.07em; margin: 0 0 8px 28px; }
  body.still .dm .msg.me .from { margin-right: 28px; }
  body.still .dm .msg .bubble { border-width: 2px; border-radius: 36px; padding: 26px 34px; font-size: 44px; line-height: 1.3; }
  body.still .scene.dm > .chrome { display: flex; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'a', 'b', 'when', 'pace', 'messages'], errs);
    str(p, 'a', errs);
    str(p, 'b', errs);
    str(p, 'when', errs, true);
    if (typeof p.a === 'string' && p.a === p.b) errs.push('`a` and `b` must be two different people');
    if (p.pace !== undefined && !['slow', 'normal', 'fast'].includes(p.pace)) errs.push('`pace` must be slow, normal or fast');
    if (!Array.isArray(p.messages) || p.messages.length < MIN || p.messages.length > MAX) {
      errs.push(`\`messages\` must be a list of ${MIN} to ${MAX} messages`);
      if (!Array.isArray(p.messages)) return errs;
    }
    p.messages.forEach((/** @type {any} */ m, /** @type {number} */ i) => {
      const at = `messages[${i}]`;
      if (!m || typeof m !== 'object') return errs.push(`${at} must be an object`);
      if (typeof m.from !== 'string' || !m.from.trim()) errs.push(`${at}.from is required`);
      else if (m.from !== p.a && m.from !== p.b) errs.push(`${at}.from must be \`a\` or \`b\` (${p.a} or ${p.b}), not ${m.from}`);
      if (typeof m.text !== 'string' || !m.text.trim()) errs.push(`${at}.text is required`);
      else if (m.text.length >= CHARS) errs.push(`${at}.text must be under ${CHARS} characters (has ${m.text.length})`);
      for (const k of Object.keys(m)) {
        if (k === 'link') errs.push(`${at}: a dm has no link cards; put the link in a \`chat\``);
        else if (!['from', 'text'].includes(k)) errs.push(`${at}: unknown prop \`${k}\``);
      }
    });
    return errs;
  },
  fixture: {
    type: 'dm',
    a: 'Priya',
    b: 'Tom',
    when: 'Fri 4:51 pm',
    pace: 'slow',
    messages: [
      { from: 'Tom', text: 'are you actually going tonight' },
      { from: 'Priya', text: 'are you' },
      { from: 'Tom', text: 'i will if you will' },
      { from: 'Priya', text: 'i said keen in the group so i kind of have to' },
      { from: 'Tom', text: 'same. ugh' },
    ],
  },
  scene(p, ctx, tl, root) {
    const me = ctx.me;
    const names = `${p.a} & ${p.b}`;
    if (skipsTime(p)) skipCard(sceneBefore(root, ''), /** @type {string} */ (p.when), names, tl);

    root.classList.add('dm');
    const room = el('div', 'room');
    const head = el('div', 'head');
    head.append(el('div', 'title', `${esc(p.a)}<span class="amp">&amp;</span>${esc(p.b)}`), el('div', 'when', esc(p.when || '')));
    const stream = el('div', 'stream');
    root.append(room, head, stream);
    tl.enter(root);
    pop(head, tl.now + 0.02, 0.28);
    tl.add(0.3);

    const pace = p.pace === 'slow' ? 1.3 : p.pace === 'fast' ? 0.85 : 1;
    let prev = '';
    p.messages.forEach((m, k) => {
      const last = k === p.messages.length - 1;
      const typeFor = 0.35 * pace;
      const typing = el('div', 'typing' + (m.from === me ? ' me' : ''));
      typing.appendChild(el('div', 'bubble', '<span></span><span></span><span></span>'));
      typing.querySelectorAll('span').forEach((d, i) =>
        d.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }],
          { duration: 500, delay: i * 120, iterations: Infinity, easing: 'ease-in-out' }));
      stream.appendChild(typing);
      const typingH = naturalHeight(typing);
      reserve(typing, tl.now, typingH);
      pop(typing, tl.now, 0.2);
      if (k > 0) glide(stream, tl.now, typingH + GAP);
      tl.add(typeFor);

      const t = tl.now;
      // the name shows only when the speaker changes; `same` is for the still
      const node = el('div', 'msg' + (m.from === me ? ' me' : '') + (m.from === prev ? ' same' : ''));
      if (m.from !== prev) node.appendChild(el('div', 'from', esc(m.from)));
      node.appendChild(el('div', 'bubble', esc(m.text)));
      stream.insertBefore(node, typing);
      const nodeH = naturalHeight(node);
      // the typing bubble hands its slot to the message: the stack moves once, by the difference
      anim(typing, [{ opacity: 1 }, { opacity: 0 }], t, 0.01, 'step-start', 'forwards');
      unreserve(typing, t, typingH);
      reserve(node, t, nodeH);
      pop(node, t, 0.3);
      if (k > 0) glide(stream, t, nodeH - typingH);
      tl.cue(m.from === me ? 'send' : 'pop', t);
      prev = m.from;
      tl.add((0.35 + 0.02 * m.text.length + (last ? 0.45 : 0)) * pace);
    });
    const end = tl.now;
    tl.exit(root, end - 0.22);
    return { poster: end - 0.23 };
  },
};

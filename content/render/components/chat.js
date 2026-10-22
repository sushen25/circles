// @ts-check
/**
 * A group chat: messages arrive behind typing bubbles; a message may carry a
 * link card. A `when` with no digits ("Three weeks later") first plays the
 * full-screen time-skip card.
 */
import { anim, contentHeight, EASE_IN_OUT, EASE_OUT, el, esc, hide, known, pop, reserve, sceneBefore, str, unreserve } from './_kit.js';
import { skipCard } from './_skip.js';

/**
 * @typedef {{ url: string, title: string, sub?: string, domain?: string }} Link
 * @typedef {{ from: string, text: string, link?: Link }} Message
 * @typedef {{ type: 'chat', title: string, when?: string, pace?: 'slow' | 'normal' | 'fast', messages: Message[] }} Props
 */

/** True when a chat opens with the time-skip card. @param {{ when?: string }} p */
export const skipsTime = (p) => !!p.when && !/\d/.test(p.when);

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'chat',
  css: `
  .chat { justify-content: flex-end; padding-bottom: 620px; }
  .chat .head { position: absolute; top: 200px; left: 100px; right: 100px; display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid var(--line); padding-bottom: 28px; }
  .chat .title { font-size: 44px; font-weight: 600; }
  .chat .when { font-family: 'Newsreader', Georgia, serif; font-size: 42px; color: var(--ink-2); }
  .chat .stream { height: 980px; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 120px); mask-image: linear-gradient(to bottom, transparent 0, #000 120px); }
  .msg { max-width: 820px; opacity: 0; transform-origin: left bottom; max-height: 0; margin-top: 0; overflow: visible; }
  .msg .from { font-size: 28px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 10px 30px; }
  .msg .bubble { background: var(--surface); border: 3px solid var(--line); border-radius: 40px; padding: 30px 40px; font-size: 54px; line-height: 1.25; }
  .msg.me .bubble { background: var(--accent); border-color: var(--accent); color: #fff; }
  .msg.me { align-self: flex-end; transform-origin: right bottom; }
  .msg.me .from { text-align: right; margin-right: 30px; }
  .msg .bubble .u { text-decoration: underline; text-underline-offset: 8px; }
  .msg .card { margin-top: 14px; background: var(--surface); border: 3px solid var(--line); border-left: 14px solid var(--accent); border-radius: 28px; padding: 28px 32px; width: 820px; opacity: 0; transform-origin: center top; }
  .msg .card .ct { font-size: 40px; font-weight: 600; line-height: 1.2; color: var(--ink); }
  .msg .card .cs { font-size: 32px; color: var(--ink-2); margin-top: 8px; line-height: 1.3; }
  .msg .card .cd { font-size: 26px; color: var(--ink-3); margin-top: 16px; letter-spacing: .04em; }
  .typing { opacity: 0; transform-origin: left bottom; max-height: 0; margin-top: 0; }
  .typing.me { align-self: flex-end; transform-origin: right bottom; }
  .typing.me .bubble { background: var(--accent-soft); border-color: var(--accent-soft); }
  .typing .bubble { display: inline-flex; gap: 14px; padding: 40px 44px; }
  .typing .bubble span { width: 20px; height: 20px; border-radius: 50%; background: var(--ink-3); opacity: 0.5; }

  /* still: every message at rest, the old carousel metrics */
  body.still .scene.chat { padding: 220px 120px 520px 120px; }
  body.still .chat .head { top: 220px; left: 120px; right: 120px; border-bottom: 2px solid var(--line); }
  body.still .chat .title { font-size: 40px; }
  body.still .chat .when { font-size: 40px; font-variant-numeric: tabular-nums; }
  body.still .chat .stream { height: auto; max-height: 1040px; gap: 26px; -webkit-mask-image: none; mask-image: none; transform: none !important; }
  body.still .chat .stream.overflows { -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 120px); mask-image: linear-gradient(to bottom, transparent 0, #000 120px); }
  body.still .chat .typing { display: none !important; }
  body.still .chat .msg { max-width: 780px; max-height: none !important; margin-top: 0 !important; }
  body.still .chat .msg.same { margin-top: -14px !important; }
  body.still .chat .msg .from { font-size: 26px; letter-spacing: 0.07em; margin: 0 0 8px 28px; }
  body.still .chat .msg.me .from { margin-right: 28px; }
  body.still .chat .msg .bubble { border-width: 2px; border-radius: 36px; padding: 26px 34px; font-size: 44px; line-height: 1.3; }
  body.still .chat .msg .card { margin-top: 12px; border: 2px solid var(--line); border-left: 12px solid var(--accent); border-radius: 24px; padding: 24px 28px; width: 780px; }
  body.still .chat .msg .card .ct { font-size: 34px; }
  body.still .chat .msg .card .cs { font-size: 28px; margin-top: 6px; }
  body.still .chat .msg .card .cd { font-size: 24px; margin-top: 14px; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'title', 'when', 'pace', 'messages'], errs);
    str(p, 'title', errs);
    str(p, 'when', errs, true);
    if (p.pace !== undefined && !['slow', 'normal', 'fast'].includes(p.pace)) errs.push('`pace` must be slow, normal or fast');
    if (!Array.isArray(p.messages) || p.messages.length === 0) {
      errs.push('`messages` must be a non-empty list');
      return errs;
    }
    p.messages.forEach((m, i) => {
      const at = `messages[${i}]`;
      if (!m || typeof m !== 'object') return errs.push(`${at} must be an object`);
      if (typeof m.from !== 'string' || !m.from.trim()) errs.push(`${at}.from is required`);
      if (typeof m.text !== 'string' || !m.text.trim()) errs.push(`${at}.text is required`);
      for (const k of Object.keys(m)) if (!['from', 'text', 'link'].includes(k)) errs.push(`${at}: unknown prop \`${k}\``);
      if (m.link !== undefined) {
        if (typeof m.link?.url !== 'string' || typeof m.link?.title !== 'string') errs.push(`${at}.link needs url and title`);
        else if (typeof m.text === 'string' && !m.text.includes(m.link.url)) errs.push(`${at}.link.url does not appear in the message text`);
      }
    });
    return errs;
  },
  fixture: {
    type: 'chat',
    title: 'Thursday crew',
    when: 'Sun 7:42 pm',
    messages: [
      { from: 'Priya', text: 'dinner this week?' },
      { from: 'Tom', text: 'keen' },
      { from: 'Nina', text: 'thu or fri works' },
      { from: 'Marcus', text: 'will check and get back to you' },
      { from: 'Priya', text: "mark the times you'd actually be up for: wenna.app/j/7f3k",
        link: { url: 'wenna.app/j/7f3k', title: 'Thursday crew is finding a time to catch up', sub: "Pick the times you'd actually be up for. No app needed.", domain: 'wenna.app' } },
    ],
  },
  scene(p, ctx, tl, root) {
    const me = ctx.me;
    if (skipsTime(p)) skipCard(sceneBefore(root, ''), /** @type {string} */ (p.when), p.title, tl);

    root.classList.add('chat');
    const head = el('div', 'head');
    head.append(el('div', 'title', esc(p.title)), el('div', 'when', esc(p.when || '')));
    const stream = el('div', 'stream');
    root.append(head, stream);
    tl.enter(root);
    pop(head, tl.now + 0.02, 0.28);
    tl.add(0.3);

    const pace = p.pace === 'slow' ? 1.3 : p.pace === 'fast' ? 0.85 : 1;
    let prev = '';
    p.messages.forEach((m, k) => {
      const last = k === p.messages.length - 1;
      const typeFor = (m.link ? 0.45 : 0.35) * pace;
      const typing = el('div', 'typing' + (m.from === me ? ' me' : ''));
      typing.appendChild(el('div', 'bubble', '<span></span><span></span><span></span>'));
      typing.querySelectorAll('span').forEach((d, i) =>
        d.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }],
          { duration: 500, delay: i * 120, iterations: Infinity, easing: 'ease-in-out' }));
      stream.appendChild(typing);
      reserve(typing, tl.now, 200);
      pop(typing, tl.now, 0.2);
      hide(typing, tl.now + typeFor);
      unreserve(typing, tl.now + typeFor);
      tl.add(typeFor);

      const t = tl.now;
      // `same` only matters to the still metrics; the video simply omits the name.
      const node = el('div', 'msg' + (m.from === me ? ' me' : '') + (m.from === prev ? ' same' : ''));
      if (m.from !== prev) node.appendChild(el('div', 'from', esc(m.from)));
      let text = esc(m.text);
      if (m.link) text = text.replace(esc(m.link.url), `<span class="u">${esc(m.link.url)}</span>`);
      node.appendChild(el('div', 'bubble', text));
      stream.insertBefore(node, typing);
      reserve(node, t);
      pop(node, t, 0.3);
      tl.cue(m.from === me ? 'send' : 'pop', t);
      prev = m.from;
      // reading time scales with length; the last message in a scene lingers
      let hold = (0.35 + 0.02 * m.text.length + (last ? 0.45 : 0)) * pace;
      if (m.link) {
        const card = el('div', 'card');
        card.append(el('div', 'ct', esc(m.link.title)), el('div', 'cs', esc(m.link.sub || '')), el('div', 'cd', esc(m.link.domain || 'wenna.app')));
        node.appendChild(card);
        anim(card, [{ opacity: 0, transform: 'translateY(16px) scale(.97)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], t + 0.5, 0.3, EASE_OUT);
        tl.cue('tick', t + 0.5);
        hold += 0.7;
      }
      tl.add(hold);
    });
    // still: a chat too long for its slide fades out under its header instead of running into it
    if (document.body.classList.contains('still') && contentHeight(stream) > stream.clientHeight) stream.classList.add('overflows');
    const end = tl.now;
    anim(stream, [{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }], end - 2, 2.2, EASE_IN_OUT);
    tl.exit(root, end - 0.22);
    return { poster: end - 0.23 };
  },
};

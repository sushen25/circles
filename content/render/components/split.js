// @ts-check
/**
 * Two components on one screen, built for the group chat plus the dm
 * underneath it. Each child runs its own scene into a pane; the pane renders
 * it at full size (1080 wide) and scales it down, so the child needs no
 * half-width variant.
 *
 * Layout: the panes are stacked and offset, the group chat up and to the
 * left, the dm below and to the right, each scaled to 0.7 (video) / 0.82
 * (still). Side by side would mean a scale of 0.5 and 27px bubble text; at
 * 0.7 the video's 54px bubbles land at 38px and the still's 44px at 36px.
 * When the dm starts, the group chat dims so the eye goes to the side room.
 *
 * Children: `chat` and `dm` only for now (split cannot import the registry
 * without a cycle). A digitless `when` (the time-skip card) is rejected in a
 * child: the card is full-screen and has no place inside a pane.
 * `order`: "sequence" only (left plays fully, then right).
 */
import { anim, el, injectCss, known, Timeline } from './_kit.js';
import chat, { skipsTime } from './chat.js';
import dm from './dm.js';

/** @type {Record<string, import('./_kit.js').Component<any>>} */
const CHILDREN = { chat, dm };

/**
 * @typedef {{ type: 'split', left: any, right: any, order?: 'sequence' }} Props
 */

/** A pause between the left finishing and the right starting, and a hold at the end. */
const GAP = 0.25;
const HOLD = 0.5;

/** A clock for a child that cannot slide its own root out: split exits both panes together. */
class PaneTimeline extends Timeline {
  exit() {}
}

/** @type {import('./_kit.js').Component<Props>} */
export default {
  type: 'split',
  takesCaption: false,
  css: `
  .split .pane { position: absolute; width: 1080px; transform-origin: top left; transform: scale(.7); }
  .split .pane.left { left: 40px; top: 140px; height: 820px; }
  .split .pane.right { left: 284px; top: 740px; height: 1100px; }
  /* a child root: what .scene gives a full-screen scene, sized to the pane */
  .split .pane > .sub { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; opacity: 0; will-change: transform, opacity; }
  .split .pane > .sub.chat { padding: 170px 60px 40px; }
  .split .pane > .sub.chat .head { top: 40px; left: 60px; right: 60px; }
  .split .pane > .sub.dm { padding: 180px 80px 60px; }
  .split .pane > .sub.dm .room { top: 10px; left: 20px; right: 20px; bottom: 10px; }
  .split .pane > .sub.dm .head { top: 50px; left: 80px; right: 80px; }
  .split .pane > .sub .stream { flex: 1 1 auto; height: auto; min-height: 0; }

  /* still: chat's 44px still bubbles at 0.82 → 36px */
  body.still .split .pane { transform: scale(.82); }
  body.still .split .pane.left { left: 40px; top: 140px; height: 760px; }
  body.still .split .pane.right { left: 154px; top: 780px; height: 970px; }
  body.still .split .pane > .sub.chat { padding: 150px 60px 30px; }
  body.still .split .pane > .sub.chat .head { top: 30px; left: 60px; right: 60px; }
  body.still .split .pane > .sub.dm { padding: 160px 80px 50px; }
  body.still .split .pane > .sub.dm .room { top: 10px; left: 20px; right: 20px; bottom: 10px; }
  body.still .split .pane > .sub.dm .head { top: 40px; left: 80px; right: 80px; }
  body.still .split .pane > .sub .stream { max-height: none; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 90px); mask-image: linear-gradient(to bottom, transparent 0, #000 90px); }
  body.still .scene.split > .chrome { display: flex; }
  `,
  schema(p) {
    const errs = [];
    known(p, ['type', 'left', 'right', 'order'], errs);
    // the pill would sit on the dm pane; put the caption on the slide before or after
    if ('caption' in p) errs.push('split takes no `caption`: the pill would cover the dm pane');
    if (p.order !== undefined && p.order !== 'sequence') {
      errs.push(p.order === 'interleave'
        ? '`order: "interleave"` is not supported yet; use "sequence" (left plays fully, then right)'
        : '`order` must be "sequence"');
    }
    for (const side of ['left', 'right']) {
      const child = p[side];
      if (!child || typeof child !== 'object') {
        errs.push(`\`${side}\` is required (a chat or dm slide)`);
        continue;
      }
      const comp = CHILDREN[child.type];
      if (!comp) {
        errs.push(`\`${side}.type\` must be chat or dm, not ${JSON.stringify(child.type)}`);
        continue;
      }
      for (const e of comp.schema(child)) errs.push(`${side}: ${e}`);
      if ('caption' in child) errs.push(`${side}: a pane takes no \`caption\``);
      if (skipsTime(child)) errs.push(`${side}: \`when\` needs a time ("Fri 6:12 pm"); a time-skip card cannot play inside split, put a \`skip\` slide before it`);
    }
    return errs;
  },
  fixture: {
    type: 'split',
    left: {
      type: 'chat',
      title: 'Thursday crew',
      when: 'Tue 6:10 pm',
      messages: [
        { from: 'Nina', text: 'friday?' },
        { from: 'Marcus', text: 'could do friday' },
        { from: 'Priya', text: 'friday works' },
        { from: 'Tom', text: 'keen' },
        { from: 'Nina', text: 'friday it is' },
      ],
    },
    right: {
      type: 'dm',
      a: 'Priya',
      b: 'Tom',
      when: 'Tue 6:12 pm',
      messages: [
        { from: 'Tom', text: "you're not free friday" },
        { from: 'Priya', text: 'neither are you' },
        { from: 'Tom', text: 'someone has to say something' },
        { from: 'Priya', text: 'not me' },
      ],
    },
  },
  scene(p, ctx, tl, root) {
    root.classList.add('split');
    const start = tl.now;
    tl.enter(root, start);

    /** @param {'left' | 'right'} side */
    const play = (side) => {
      const props = p[side];
      const comp = CHILDREN[props.type];
      injectCss(comp.type, comp.css);
      const pane = el('div', `pane ${side}`);
      // not `.scene`: stage.still() hides every `.scene` except the slide's root
      const sub = el('div', 'sub');
      sub.dataset.type = comp.type;
      pane.appendChild(sub);
      root.appendChild(pane);
      const ctl = new PaneTimeline(tl.cues, tl.now);
      comp.scene(props, ctx, ctl, sub);
      tl.now = ctl.now;
      return pane;
    };

    const left = play('left');
    tl.add(GAP);
    // the group chat steps back as the side room opens
    anim(left, [{ opacity: 1 }, { opacity: 0.55 }], tl.now, 0.4);
    play('right');
    tl.add(HOLD);
    const end = tl.now;
    tl.exit(root, end - 0.22);
    return { poster: end - 0.23 };
  },
};

// @ts-check
/**
 * The component registry. One import line and one entry per component; the
 * key is the component's `type`. A queue slide finds its component through
 * resolve(): `{ "type": "screen", "screen": "locked" }` → `screen-locked`.
 */
import cover from './cover.js';
import beat from './beat.js';
import chat from './chat.js';
import screenAvailability from './screen-availability.js';
import screenLocked from './screen-locked.js';
import compare from './compare.js';
import grid from './grid.js';
import end from './end.js';
import quote from './quote.js';
import count from './count.js';
import skip from './skip.js';
import dm from './dm.js';
import split from './split.js';
import notification from './notification.js';
import poll from './poll.js';
import calendar from './calendar.js';

/** @type {Record<string, import('./_kit.js').Component<any>>} */
export const registry = Object.fromEntries(
  [cover, beat, chat, screenAvailability, screenLocked, compare, grid, end, quote, count, skip, dm, split, notification, poll, calendar].map((c) => [c.type, c]),
);

/**
 * The component for one queue slide, or undefined for an unknown type.
 * @param {{ type: string, screen?: string }} slide
 */
export function resolve(slide) {
  if (slide?.type === 'screen') return registry[`screen-${slide.screen}`];
  return registry[slide?.type];
}

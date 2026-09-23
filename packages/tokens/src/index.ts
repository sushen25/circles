/**
 * `@circles/tokens` — the design tokens, generated from `docs/design/gen.py`,
 * plus the two bundled typefaces (ADR 0002).
 *
 * `generated.ts` is written by `pnpm gen:tokens` and must never be hand-edited;
 * `pnpm check` fails if it is stale. Components in `apps/app/src/components`
 * compose these with `StyleSheet.create` — there is no Tailwind, no NativeWind
 * and no CSS-in-JS runtime.
 */
export const PACKAGE_NAME = '@circles/tokens';

export {
  cell,
  circleColor,
  color,
  hit,
  markOverlap,
  radius,
  shadow,
  size,
  space,
  type,
} from './generated.js';
export { faceFor, fontFace, fontFallback, fontFamily, fontStack } from './fonts.js';
export type { FontFamily } from './fonts.js';

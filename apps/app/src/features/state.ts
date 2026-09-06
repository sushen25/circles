/**
 * The eight states every screen owes (manifesto §7).
 *
 * A screen is not designed until all of these exist, so they are one type
 * rather than a boolean per screen — a screen that cannot be in a state simply
 * never receives it, and the gallery shows which.
 */
export const SCREEN_STATES = [
  'default',
  'empty',
  'partial',
  'loading',
  'error',
  'offline',
  'denied',
  'expired',
] as const;

export type ScreenState = (typeof SCREEN_STATES)[number];

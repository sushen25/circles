import { createContext, useContext } from 'react';

import { color } from '@circles/tokens';

/**
 * The confirmed screen — and nothing else — runs on the inverted ground
 * (manifesto §5.1). Rather than every component taking an `invert` prop, the
 * screen puts one flag in context and components read the palette from here.
 *
 * Both palettes carry the same keys, so a component styles itself once.
 */
export type Palette = {
  ground: string;
  surface: string;
  line: string;
  /** Border on a control that sits directly on the ground. */
  lineStrong: string;
  ink: string;
  ink2: string;
  ink3: string;
  /** The current action and the member's own choices. Never decoration. */
  accent: string;
  onAccent: string;
  /** Section labels. */
  label: string;
  /** Outline of a member who has not answered. */
  waiting: string;
  /** The quiet button's accent tone: its fill and its ink (Done, Undo, Not now). */
  softFill: string;
  softInk: string;
  /** The quiet button's plain tone, the hairline one for letting go. */
  plainFill: string;
};

const light: Palette = {
  ground: color.ground,
  surface: color.surface,
  line: color.line,
  lineStrong: color.line,
  ink: color.ink,
  ink2: color.ink2,
  ink3: color.ink3,
  accent: color.accent,
  onAccent: color.surface,
  label: color.ink3,
  waiting: color.ink3,
  softFill: color.accentSoft,
  softInk: color.accentDark,
  plainFill: color.surface,
};

const inverted: Palette = {
  ground: color.invert,
  surface: color.invertSurface,
  line: color.invertLine,
  lineStrong: color.invertLineStrong,
  ink: color.invertInk,
  ink2: color.invertInk2,
  ink3: color.invertInk3,
  accent: color.invertAccent,
  onAccent: color.invert,
  label: color.invertAccent,
  waiting: color.invertMarkLine,
  // The accent on a 16% tint of itself, so it is a tone of the ground, not a patch.
  softFill: `${color.invertAccent}29`,
  softInk: color.invertAccent,
  plainFill: 'transparent',
};

const InvertContext = createContext(false);

export const InvertProvider = InvertContext.Provider;

/** True on the confirmed screen. */
export function useInverted(): boolean {
  return useContext(InvertContext);
}

export function usePalette(): Palette {
  return useInverted() ? inverted : light;
}

/**
 * GENERATED FILE — do not edit.
 *
 * Extracted from docs/design/gen.py by scripts/gen-tokens.ts (ADR 0002).
 * To change a token: edit gen.py, regenerate the canvas, run `pnpm gen:tokens`,
 * and commit all three in one PR. `pnpm check` fails if this file is stale.
 */

/** The palette. Narrow on purpose: colour always means something (manifesto §5.1). */
export const color = {
  ground: '#FBF7F1',
  surface: '#FFFFFF',
  line: '#EAE0D3',
  lineSoft: '#F1E9DE',
  ink: '#221E19',
  ink2: '#6C6156',
  ink3: '#A0958A',
  accent: '#C2542F',
  accentDark: '#A0431F',
  accentSoft: '#F6E5DC',
  support: '#4F6B45',
  supportSoft: '#E6EDE1',
  warnSurface: '#FBF0E4',
  warnInk: '#6B5427',
  invert: '#2E241C',
  invertAccent: '#E8A07A',
} as const;

/**
 * The type ramp. `lineHeight` and `letterSpacing` are absolute, in points, for
 * React Native; `lineHeightRatio` and `letterSpacingEm` are the canvas's own
 * units, kept so the two can be compared.
 */
export const type = {
  displayXL: {
    fontFamily: 'Newsreader',
    fontWeight: 400,
    fontSize: 40,
    lineHeight: 43,
    lineHeightRatio: 1.08,
    letterSpacing: -0.72,
    letterSpacingEm: -0.018,
  },
  displayL: {
    fontFamily: 'Newsreader',
    fontWeight: 400,
    fontSize: 31,
    lineHeight: 35,
    lineHeightRatio: 1.12,
    letterSpacing: -0.465,
    letterSpacingEm: -0.015,
  },
  date: {
    fontFamily: 'Newsreader',
    fontWeight: 400,
    fontSize: 24,
    lineHeight: 26,
    lineHeightRatio: 1.1,
    letterSpacing: 0,
    letterSpacingEm: 0,
  },
  title: {
    fontFamily: 'Figtree',
    fontWeight: 600,
    fontSize: 16,
    lineHeight: 21,
    lineHeightRatio: 1.3,
    letterSpacing: 0,
    letterSpacingEm: 0,
  },
  body: {
    fontFamily: 'Figtree',
    fontWeight: 400,
    fontSize: 15,
    lineHeight: 23,
    lineHeightRatio: 1.5,
    letterSpacing: 0,
    letterSpacingEm: 0,
  },
  small: {
    fontFamily: 'Figtree',
    fontWeight: 400,
    fontSize: 13,
    lineHeight: 19,
    lineHeightRatio: 1.45,
    letterSpacing: 0,
    letterSpacingEm: 0,
  },
  label: {
    fontFamily: 'Figtree',
    fontWeight: 600,
    fontSize: 12,
    lineHeight: 16,
    lineHeightRatio: 1.3,
    letterSpacing: 0.84,
    letterSpacingEm: 0.07,
    textTransform: 'uppercase',
  },
} as const;

/** Spacing rhythm (manifesto §5.3). */
export const space = {
  gutter: 22,
  section: 22,
  related: 12,
  tight: 8,
} as const;

/** Radii. Larger radius = larger element; never mix scales inside one card. */
export const radius = {
  control: 14,
  chip: 12,
  input: 13,
  cell: 6,
  mark: 8,
  card: 18,
  sheet: 22,
  pill: 999,
} as const;

/**
 * The one elevation: warm-tinted and barely there. It marks the primary action
 * and the focused card, nothing else. This is a bordered, not a shadowed,
 * interface. React Native 0.76+ accepts the CSS `boxShadow` form on every
 * platform, so the canvas value is used verbatim.
 */
export const shadow = {
  elevated: '0 1px 2px rgba(74,55,38,.04), 0 14px 30px -20px rgba(74,55,38,.28)',
} as const;

/** Minimum tap target, in points. */
export const hit = 44;

/** The availability track: a ten-cell half-hour grid (manifesto §5.4). */
export const cell = {
  height: 42,
  gap: 3,
} as const;

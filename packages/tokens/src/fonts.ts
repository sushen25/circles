/**
 * The two typefaces (design manifesto §5.2), as data.
 *
 * React Native picks a face by *family name*, not by weight: asking for
 * `fontWeight: 600` on a family that registered only its regular file gives you
 * a synthesised bold on Android and nothing on iOS. So every weight is
 * registered under its own name, and `faceFor()` maps a role's family+weight to
 * the name that was actually registered.
 *
 * The files themselves are in `@circles/tokens/font-assets`, kept separate so
 * that importing tokens does not drag binary assets into non-bundler contexts.
 */
export const fontFamily = {
  /** Dates, headlines, moments — the warmth that stops this reading as a utility. */
  display: 'Newsreader',
  /** Everything operational: labels, buttons, body, data. */
  interface: 'Figtree',
} as const;

export type FontFamily = (typeof fontFamily)[keyof typeof fontFamily];

/** Registered face names, by family and weight. */
export const fontFace = {
  Newsreader: { 400: 'Newsreader-Regular' },
  Figtree: { 400: 'Figtree-Regular', 500: 'Figtree-Medium', 600: 'Figtree-SemiBold' },
} as const;

/**
 * Metric-compatible fallbacks, because an export or an offline render will drop
 * the bundled face (manifesto §5.2).
 */
export const fontFallback = {
  Newsreader: `Georgia, 'Times New Roman', serif`,
  Figtree: `system-ui, -apple-system, 'Segoe UI', sans-serif`,
} as const;

/**
 * The face name to put in `fontFamily`, plus the fallback stack for web.
 * Throws rather than guessing: a weight with no file would silently render
 * wrong on one platform and right on another.
 */
export function faceFor(family: FontFamily, weight: number): string {
  const faces: Record<number, string> = fontFace[family];
  const face = faces[weight];
  if (!face) {
    throw new Error(
      `No ${family} face is bundled at weight ${weight}. ` +
        `Available: ${Object.keys(faces).join(', ')}. ` +
        'Add it to scripts/fetch-fonts.mjs and re-run it, or use a weight that exists.',
    );
  }
  return face;
}

/** `fontFamily` for a web stylesheet: the bundled face, then the fallbacks. */
export function fontStack(family: FontFamily, weight: number): string {
  return `${faceFor(family, weight)}, ${fontFallback[family]}`;
}

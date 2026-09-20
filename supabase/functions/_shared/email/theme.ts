/**
 * The look of an email, as the handful of values a mail client can honour.
 *
 * The colours are the design tokens' (`packages/tokens/src/generated.ts`,
 * manifesto §5.1), copied rather than imported: architecture §7.2 lets a
 * function import `domain`, `contracts` and `config`, and the tokens package is
 * none of those. `pnpm check:tokens` reads this block and fails when a value
 * here stops matching the token it is named after, so the copy cannot drift
 * quietly — keep the keys token names.
 *
 * **No web fonts are loaded.** Newsreader and Figtree lead each stack so that a
 * reader who has them installed sees them, and everybody else gets the fallback
 * the manifesto names (§5.2). A `<link>` to a font host would make every open a
 * request to a third party carrying the reader's address and the time they read
 * it — a tracking pixel by another name — and most clients strip it anyway.
 */

export const palette = {
  /** `color.ground` — the warm page behind the card. */
  ground: '#FBF7F1',
  /** `color.surface` */
  surface: '#FFFFFF',
  /** `color.line` */
  line: '#EAE0D3',
  /** `color.ink` */
  ink: '#221E19',
  /** `color.ink2` */
  ink2: '#6C6156',
  /** `color.accent` — the primary button. */
  accent: '#C2542F',
} as const;

/** Dates and the wordmark (manifesto §5.2: "the warmth that stops this reading as a utility"). */
export const displayFont = "Newsreader, Georgia, 'Times New Roman', serif";

/** Everything operational. */
export const interfaceFont =
  "Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

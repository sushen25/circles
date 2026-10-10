/**
 * The same faces for the web build, as WOFF2 (SUS-174).
 *
 * Metro prefers `font-assets.web.js` over `font-assets.js` on web, so the app's
 * root layout is unchanged and a browser downloads about half the bytes. Native
 * keeps the TrueType files in `font-assets.ts`: React Native cannot load WOFF2.
 * The two modules have to name the same faces; `index.test.ts` checks that.
 *
 * The WOFF2 files are the TrueType masters re-encoded, glyph for glyph
 * (`node scripts/fetch-fonts.mjs` writes both).
 */
import FigtreeMedium from '../assets/fonts/Figtree-Medium.woff2';
import FigtreeRegular from '../assets/fonts/Figtree-Regular.woff2';
import FigtreeSemiBold from '../assets/fonts/Figtree-SemiBold.woff2';
import NewsreaderRegular from '../assets/fonts/Newsreader-Regular.woff2';

export const fontAssets = {
  'Figtree-Regular': FigtreeRegular,
  'Figtree-Medium': FigtreeMedium,
  'Figtree-SemiBold': FigtreeSemiBold,
  'Newsreader-Regular': NewsreaderRegular,
} as const;

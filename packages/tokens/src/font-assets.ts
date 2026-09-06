/**
 * The bundled font files, keyed by the face name they register as.
 *
 * Imported by the app's root layout and handed straight to `expo-font`'s
 * `useFonts`. Kept out of the package's main entry point so that importing
 * tokens in a plain Node context (tests, the token generator) does not try to
 * resolve a `.ttf`.
 *
 * The files are downloaded by `node scripts/fetch-fonts.mjs` and committed —
 * see `packages/tokens/assets/fonts/` and the OFL licences beside them.
 */
import FigtreeMedium from '../assets/fonts/Figtree-Medium.ttf';
import FigtreeRegular from '../assets/fonts/Figtree-Regular.ttf';
import FigtreeSemiBold from '../assets/fonts/Figtree-SemiBold.ttf';
import NewsreaderRegular from '../assets/fonts/Newsreader-Regular.ttf';

export const fontAssets = {
  'Figtree-Regular': FigtreeRegular,
  'Figtree-Medium': FigtreeMedium,
  'Figtree-SemiBold': FigtreeSemiBold,
  'Newsreader-Regular': NewsreaderRegular,
} as const;

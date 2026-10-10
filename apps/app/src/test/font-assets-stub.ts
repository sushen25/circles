/**
 * `@circles/tokens/font-assets` as Vitest sees it: the bundler hands each face
 * a number, here the same four, so the middleware can ask for their URLs
 * (`expo-asset-stub.ts` turns a number into one). The real module is a list of
 * font files, which only a bundler can resolve.
 */
export const fontAssets = {
  'Figtree-Regular': 1,
  'Figtree-Medium': 2,
  'Figtree-SemiBold': 3,
  'Newsreader-Regular': 4,
} as const;

/** The URL `expo-asset-stub.ts` gives each of the stubbed faces. */
export const STUB_FONT_URLS: Record<keyof typeof fontAssets, string> = {
  'Figtree-Regular': '/assets/__packages/tokens/assets/fonts/Figtree-Regular.aaaa.woff2',
  'Figtree-Medium': '/assets/__packages/tokens/assets/fonts/Figtree-Medium.bbbb.woff2',
  'Figtree-SemiBold': '/assets/__packages/tokens/assets/fonts/Figtree-SemiBold.cccc.woff2',
  'Newsreader-Regular': '/assets/__packages/tokens/assets/fonts/Newsreader-Regular.dddd.woff2',
};

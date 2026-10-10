/**
 * Zod ships 63 locale files and a namespace re-export of all of them
 * (`export * as locales from "../locales/index.js"` in `zod/v4/core/index.js`).
 * A namespace re-export cannot be tree-shaken, so every one of them landed in
 * the web bundle: 266 KB raw of a 487 KB zod, for one locale (`en`) the app
 * uses (SUS-174).
 *
 * This resolver answers every locale but `en` (and the `index` that re-exports
 * them) with an empty module. The names stay exported by `index`, bound to
 * nothing, so nothing fails to load; calling `z.locales.de()` is what breaks,
 * and `src/test/metro-zod-locales.test.ts` is where that is written down.
 *
 * Plain CommonJS because Metro reads its config with `require`. The Edge
 * Functions run on Deno and never see Metro; their copy of zod is a separate
 * question.
 */

/** `.../zod/v4/locales/de.js` -> `de`; anything else -> null. */
function localeName(filePath) {
  const match = /[\\/]zod[\\/]v4[\\/]locales[\\/]([^\\/]+)\.[cm]?js$/.exec(filePath);
  return match ? match[1] : null;
}

/** Locales that stay real: the one in use, and the index that names the rest. */
const KEPT = new Set(['en', 'index']);

/**
 * A Metro `resolveRequest`: resolve as usual, then swap a stubbed locale for an
 * empty module. Resolving first means the relative `./de.js` that `index.js`
 * imports is caught as well as a direct `zod/v4/locales/de.js`.
 */
function stubZodLocales(context, moduleName, platform) {
  const resolution = context.resolveRequest(context, moduleName, platform);
  if (resolution.type !== 'sourceFile') return resolution;
  const name = localeName(resolution.filePath);
  return name === null || KEPT.has(name) ? resolution : { type: 'empty' };
}

module.exports = { stubZodLocales, localeName };

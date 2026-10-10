/**
 * On web, `@circles/tokens/font-assets` is its `.web` twin: the same four faces
 * as WOFF2, about half the bytes (SUS-174).
 *
 * Metro picks `.web.js` over `.js` for a file it finds by name, but not for a
 * file a package's `exports` map points at, so the platform's module is named
 * here. It applies to every web bundle, the pre-render included: the HTML's
 * preloads and `@font-face` rules have to name the files the browser will use,
 * or a visitor downloads both sets.
 */
const FROM = '@circles/tokens/font-assets';
const TO = '@circles/tokens/font-assets.web';

/** The module to resolve for a request: the WOFF2 twin on web, the request itself elsewhere. */
function fontModuleFor(moduleName, platform) {
  return platform === 'web' && moduleName === FROM ? TO : moduleName;
}

module.exports = { fontModuleFor };

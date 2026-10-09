// Metro's configuration for the app: Expo's defaults, plus one resolver
// (SUS-174), and the WOFF2 asset type. There was no config before, so nothing
// else changes.
const { getDefaultConfig } = require('expo/metro-config');

const { stubZodLocales } = require('./metro/stub-zod-locales');
const { fontModuleFor } = require('./metro/web-font-assets');

const config = getDefaultConfig(__dirname);

// WOFF2 is what the web build loads its fonts as (`@circles/tokens/font-assets`
// resolves to `font-assets.web.js` there); Metro does not know the extension.
if (!config.resolver.assetExts.includes('woff2')) config.resolver.assetExts.push('woff2');

// Metro hands a resolver a context whose own `resolveRequest` is the default
// resolution; `stubZodLocales` calls it first, then judges the file it found.
config.resolver.resolveRequest = (context, moduleName, platform) =>
  stubZodLocales(context, fontModuleFor(moduleName, platform), platform);

module.exports = config;

import { brand } from '@circles/config';
import { color } from '@circles/tokens';

import { t } from '../../copy';
import { escapeHtml } from '../../data/preview';
import { close, free, header, hero, how, organisers, privacy } from './sections';
import { siteCss, type SiteFonts } from './styles';

/**
 * The site, as one HTML document with no script in it.
 *
 * Served by the middleware at `/` (ADR 0052) rather than rendered by a route:
 * the route tree's root renders a neutral shell until React has hydrated
 * (ADR 0040), which is right for a screen that depends on the visitor and
 * wrong for a page that is the same for everyone and has to be there, words
 * and all, before anything runs. Nothing here depends on the visitor, the
 * clock or the locale, so nothing here can be a guess.
 *
 * No third-party request: the fonts are the app's own files, at the URLs the
 * app loads them from, the mark is inline, and there is no analytics script. The one event the site
 * records is sent by the app when it opens from the button
 * (`useSiteArrival`).
 */
export function sitePage(origin: string, fonts: SiteFonts): string {
  const title = `${brand.name} — ${brand.descriptor}`;
  const description = t('site', 'meta_description');
  const image = `${origin}/og-card.png`;
  const meta = (name: string, content: string, attr = 'property') =>
    `<meta ${attr}="${name}" content="${escapeHtml(content)}">`;
  const preload = [fonts.newsreader, fonts.figtreeRegular, fonts.figtreeSemiBold]
    .map((href) => `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(origin)}/">
${meta('og:type', 'website')}${meta('og:site_name', brand.name)}${meta('og:title', title)}${meta('og:description', description)}${meta('og:url', `${origin}/`)}${meta('og:image', image)}${meta('og:image:alt', t('site', 'image_alt'))}${meta('twitter:card', 'summary_large_image', 'name')}
<meta name="theme-color" content="${color.ground}">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
${preload}
<style>${siteCss(fonts)}</style>
</head>
<body>
<a class="skip" href="#top">${escapeHtml(t('site', 'skip'))}</a>
${header()}
<main id="top">${hero()}${how()}${privacy()}${organisers()}${free()}</main>
${close()}
</body>
</html>
`;
}

/** What the middleware answers with. Public and short-lived: it is the same for everybody. */
export const SITE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

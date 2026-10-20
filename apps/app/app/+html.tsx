import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { color } from '@circles/tokens';

/**
 * The document every route is served in (ADR 0040). It replaces Expo Router's
 * default, whose reset paints `body` white (and black in dark mode): the app
 * paints the ground only inside the safe area, so on iPhone Safari the white
 * showed behind the status bar and around the bottom toolbar, and before React
 * had rendered anything (SUS-234).
 *
 * The ground is `color.ground`, read from the tokens. There is no dark
 * override: the app runs light (`userInterfaceStyle: 'light'`, manifesto §5.1),
 * and `color-scheme: light` keeps the browser from darkening the page itself.
 *
 * `viewport-fit=cover` (SUS-235) lets the ground run under the status bar and the
 * bottom toolbar, so the safe area is padded by the app and not by the browser:
 * `Screen` and `Sheet` read the insets, the landing page reads `env()`.
 *
 * The `theme-color` meta lives in `_layout.tsx` with the other head tags. No
 * inline script belongs in this file: the Content-Security-Policy hashes the
 * one the export emits and allows no other.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" style={{ colorScheme: 'light' }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <ScrollViewStyleReset />
        <style
          id="ground"
          dangerouslySetInnerHTML={{
            __html: `html,body{background-color:${color.ground}}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

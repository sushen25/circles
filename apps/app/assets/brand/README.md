# Wenna brand assets

Vector masters for the Wenna mark, "Room at the table" (locked 29 Sep 2026). Five terracotta lozenges
around a shared empty centre; the sixth seat is a dotted outline, kept open for you. Export every raster
(app icons, favicons, OG image) from these files; never redraw by hand.

| File                       | Use                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `wenna-mark.svg`           | The mark, 120 px master. Terracotta `#C2542F`. Use at 40 px and above.                                                                   |
| `wenna-mark-small.svg`     | Same geometry with heavier dots on the open seat. Use for favicons, tab bars and anything 32 px or smaller.                              |
| `wenna-mark-mono.svg`      | Single-colour white silhouette for the Android notification small icon and monochrome adaptive layer.                                    |
| `wenna-lockup.svg`         | Mark plus the lowercase `wenna` wordmark in Newsreader 400, ink `#221E19`. Loads the font from Google Fonts; outline the type for print. |
| `wenna-app-icon-light.svg` | 1024 px app icon: mark on warm ground `#FBF7F1`. Source for `icon.png`, the iOS set and the Android adaptive foreground.                 |
| `wenna-app-icon-dark.svg`  | 1024 px dark variant: peach `#E8A07A` on `#2E241C`. iOS dark icon and the confirmed-moment surfaces.                                     |

Rules: terracotta on warm ground, never pure black, never a gradient. Wordmark is always lowercase serif,
tight tracking (about -0.03em); never caps or a grotesque. App icon carries the mark alone, no wordmark.
Nothing is added around the mark: no rings, clocks, calendar pages, ticks, chat bubbles or pins.

Sources: the brand doc "Circles Name and Brand Identity" and the "Wenna Logo Options" canvas (option E).

## Rasters

Every PNG and the favicon set are rendered from these masters by `pnpm gen:brand`
(`scripts/gen-brand-assets.ts`), which also samples each file and fails if a pixel is not the
brand's hex. Re-run it after changing a master and commit what it writes:

| Output                                                                                 | From                                                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `assets/icon.png`, `icon-dark.png`, `icon-tinted.png`                                  | mark on warm ground, peach on dark, mono on transparent (iOS 18 appearances) |
| `assets/android-icon-foreground.png`, `-background.png`, `-monochrome.png`             | mark inside the 66/108 adaptive safe zone; flat `#FBF7F1`; mono              |
| `assets/splash-icon.png`                                                               | mark on transparent; the splash ground is set in `app.config.ts`             |
| `assets/notification-icon.png`                                                         | small master's geometry in the mono colour, for the Android status bar       |
| `assets/favicon.png`, `public/favicon.ico` (16/32/48), `public/favicon.svg`            | small master                                                                 |
| `public/apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | mark on warm ground                                                          |
| `public/brand/wenna-lockup-2x.png`, `wenna-lockup-dark-2x.png`                         | the email header, 280 × 80 shown at 140 × 40                                 |
| `public/og-card.png`                                                                   | the link-preview image, 1200 × 630: lockup and descriptor on warm ground     |
| `public/manifest.webmanifest`                                                          | written from `brand`                                                         |
| `public/fonts/*.ttf`, `src/features/site/mark.generated.ts`                            | the site's fonts and mark: copied from `packages/tokens` and the master      |

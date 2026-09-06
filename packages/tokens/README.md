# @circles/tokens

The design tokens and the two bundled typefaces. Generated from
`docs/design/gen.py` — the script that draws the 80 artboards in `docs/design/`
— so the canvas and the app cannot disagree (ADR 0002).

## Changing a token

Edit `docs/design/gen.py`, regenerate the canvas, then:

```bash
pnpm gen:tokens
```

Commit the canvas change and `src/generated.ts` in the same PR. `pnpm check`
runs `check:tokens`, which regenerates and fails on any diff, so a `gen.py` edit
that was never propagated cannot merge.

**Never hand-edit `src/generated.ts`.** Every value in it is parsed from the
canvas; the extractor throws and names what is missing if a rule it depends on
is renamed or removed, and refuses colours the app does not know about.

## What is exported

| Export                                                           | What                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `color`                                                          | the 16-colour palette (manifesto §5.1)                                                                                    |
| `type`                                                           | 7 roles, each with absolute `lineHeight`/`letterSpacing` for React Native and the canvas's own ratio and `em` beside them |
| `space`                                                          | `gutter`, `section`, `related`, `tight`                                                                                   |
| `radius`                                                         | `control`, `chip`, `input`, `cell`, `mark`, `card`, `sheet`, `pill`                                                       |
| `shadow.elevated`                                                | the one warm elevation, as a CSS `boxShadow` string (React Native 0.76+ accepts it on every platform)                     |
| `hit`                                                            | minimum tap target, 44                                                                                                    |
| `cell`                                                           | the availability track cell: height and gap                                                                               |
| `faceFor`, `fontStack`, `fontFace`, `fontFallback`, `fontFamily` | typeface names and fallbacks                                                                                              |
| `@circles/tokens/font-assets`                                    | the font files, for `expo-font`                                                                                           |

## Fonts

Newsreader (display) and Figtree (interface), with metric-compatible fallbacks
because an export or an offline render will drop the bundled face
(manifesto §5.2). The files live in `assets/fonts/` with their OFL-1.1 licences
and are committed, so a build never depends on Google being reachable.

**React Native selects a face by family name, not by weight.** Each weight is
registered under its own name — `Figtree-Regular`, `Figtree-Medium`,
`Figtree-SemiBold`, `Newsreader-Regular` — and `faceFor(family, weight)` maps a
role to the name that was actually registered. Asking for `fontWeight: 600` on a
family that only registered its regular file gives a synthesised bold on Android
and nothing on iOS, which is exactly the kind of bug that looks fine on one
platform in review.

To add a weight: add it to `FAMILIES` in `scripts/fetch-fonts.mjs`, run
`node scripts/fetch-fonts.mjs`, add the file to `src/font-assets.ts` and the
weight to `fontFace` in `src/fonts.ts`. `faceFor` throws for a weight with no
file rather than guessing.

`scripts/fetch-fonts.mjs` asks the Google Fonts CSS API with a deliberately
ancient user agent, because that is the only way it still serves per-weight
static TTFs: `github.com/google/fonts` now ships variable fonts only, and the
modern `css2` endpoint returns woff subsetted by unicode-range, which native
cannot load.

## Gotcha

After changing this package's `exports`, restart Metro with `--clear`. Metro
caches module resolution, and a stale cache reports the new subpath as "could
not be found within the project" — which reads exactly like a misconfiguration.

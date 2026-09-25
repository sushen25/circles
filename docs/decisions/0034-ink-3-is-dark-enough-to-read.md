# ADR 0034: `ink-3` is dark enough to read

_Status: proposed · 24 September 2026_

## Context

The manifesto sets `ink-3`, `#A0958A`, for "labels, metadata, placeholders",
and both the manifesto (§6) and the spec (§10) hold the product to WCAG 2.2 AA
on mobile web. AA asks 4.5:1 of text at the sizes `ink-3` is used at (12–14
px). `#A0958A` is 2.74:1 on `ground` and 2.93:1 on `surface`.

Nobody had measured it until S1-31's accessibility spec ran axe on the four
screens a guest and an organiser cannot avoid. Every serious finding on
Join, the availability editor and the organiser's options was this one
colour: "You're invited", "1 person is in so far", the weekday under each
day, "My answer", "Count me in for whatever works for most people", "Best
attendance", "Alex hasn't answered", "Nudge Alex", "Edit the plan" — and
"None of these dates work for me", which is a decision, set in a colour a
person with ordinary eyesight in sunlight struggles to read.

It is used for words people need, not only for decoration, so the fix is the
token rather than moving the words to `ink-2`.

## Decision

**`ink-3` is `#796D61`.** The same warm hue, darkened until it clears 4.5:1
with a little to spare: 4.72:1 on `ground`, 5.03:1 on `surface`. The token is
changed where it is defined (`docs/design/gen.py`), and the canvas and
`packages/tokens` are regenerated from it; no screen names a colour itself.

`ink-2` (`#6C6156`, 5.65:1) stays the secondary text. The step between the two
is smaller than it was, and still visible.

## Alternatives considered

- **Move the text to `ink-2` and keep `ink-3` for non-text.** Every label and
  hint in the product would change token by hand, the manifesto's three-step
  ink scale would become two for text, and the next label written in `ink-3`
  would fail again.
- **Keep `#A0958A` and exclude `color-contrast` from the check.** The spec's
  rule would be written down and not kept; the ticket's criterion ("no
  violations at serious or above") would be met by not looking.
- **The lightest passing shade, `#7C7064` (4.51:1).** Passes by a rounding
  margin; a slightly different ground or a browser's colour management would
  tip it under.

## Consequences

- Labels, hints and metadata are darker everywhere, the canvas included.
- `ink-3` on `warn-surface` is 4.48:1 and on `line-soft` 4.18:1. Neither is
  where text sits today; a new use there needs `ink-2`.
- `invert-ink3` (on the dark ground) was not measured by this change and is
  not used on the four screens the spec checks.
- `tests/e2e-live/a11y.spec.ts` keeps it: a colour that regresses fails the
  suite in all four browsers.

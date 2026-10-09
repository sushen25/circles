---
adr: 43
title: "The product is Wenna, the link preview says what the brand doc says, and a confirmation signs off with the day"
status: proposed
date: 2026-09-29
---
# ADR 0043: The product is Wenna, the link preview says what the brand doc says, and a confirmation signs off with the day

_Status: proposed · 29 September 2026_

## Context

Architecture §5.4 kept the product nameless on purpose: one file,
`packages/config/src/brand.ts`, held a placeholder, so that renaming would be a
change to that file rather than a refactor. The name was locked on 28 September
2026 as **Wenna** ("WEN-uh", descriptor "Plans with friends"), and the mark,
"Room at the table", on 29 September. The brand doc ("Circles Name and Brand
Identity") and the logo canvas (option E) are the sources, and SUS-98 rolls
them out.

Two of the brand doc's "Applied" lines change words the spec wrote down:

- **Link preview.** Spec §5.2 had the card say "Pick the times you'd actually
  be up for. No app needed." The brand doc's line is "Pick the times you'd be
  up for. About a minute, and nobody sees your calendar."
- **Locked-in message.** The brand doc signs a confirmation off "Thursday it
  is." with "See you then." beneath, and asks for an ADR for it. Nothing in the
  spec or on the canvas says it today.

## Decision

1. **The product is Wenna; Circles is the codename.** `brand.name` is `Wenna`,
   the sender is `Wenna <…>`, and `brand.descriptor` is "Plans with friends".
   The package scope (`@circles/*`), the bundle-identifier prefix
   (`app.circles.*`), the EAS slug and the deep-link scheme stay `circles`:
   installed builds and the links they claim depend on them, and changing one
   is its own decision with its own migration. "circle" stays the in-product
   word for a group. The holding domain stays until SUS-99 moves to
   `wenna.app`.
2. **The link preview's description is the brand doc's line.** The title is
   unchanged ("Sunday Crew is finding a time to catch up"), because the circle
   is what the reader recognises; the product is named beside it, as
   `og:site_name`, and on the card image. The privacy rule of §5.2 is untouched:
   the description still takes no state.
3. **A confirmation ends on the day.** "[Weekday] it is." and then "See you
   then." — the weekday alone, because the date is already above it. It lands
   first on the locked-in email, as its last two lines before the button.

## Alternatives considered

- **`og:title` = "Wenna".** The ticket's shorthand read this way. A chat shows
  the title largest, and "Wenna" there tells a group nothing about why the link
  is in their chat; the circle's name does. `og:site_name` is the tag chat apps
  show as the source line, which is where a product name belongs.
- **Sign off in the share message and the confirmed screens too, now.** The
  brand doc means every confirmation. The share messages are the ShareMessages
  artboard's wording and the confirmed screens are canvas artboards, so each is
  a canvas change first; they are left to a ticket of their own (SUS-100)
  rather than drifting from the canvas here.
- **Rename the scheme and bundle prefix with the name.** Existing installs and
  universal links would break for a cosmetic gain nobody sees.

## Consequences

- Spec §5.2's preview line and the codename notes in the spec and the
  architecture are updated in the same PR.
- `pnpm check:brand` now guards `Wenna`, the way it guarded the placeholder: the
  name is read from `brand`, never written out.
- Every raster of the mark is rendered from the SVG masters in
  `apps/app/assets/brand/` by `pnpm gen:brand`, which fails if an exported pixel
  is not the brand's hex.
- Until SUS-100 lands, the locked-in email signs off and the share message and
  confirmed screens do not.

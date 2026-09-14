import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
import { z } from 'zod';

import { CircleDto } from '../dtos.js';
import { Zone } from '../time.js';
import { Mutation } from './shared.js';

/**
 * `create-circle` — the circle and its first invite, in one call.
 *
 * Two typed inputs and no permission dialogs is the acceptance criterion
 * (spec §5.1), so this takes a name and a cadence and derives the rest: the
 * zone comes from the device, the colour from the palette, everything else from
 * the circle's defaults.
 *
 * Refuses an anonymous caller with `requires_saved_place` — creating a circle
 * needs a saved place ([ADR 0004](../../../../docs/decisions/0004-organiser-requires-permanent-identity.md)),
 * and that reason is what tells the client to show InitiateGate rather than an
 * error.
 */
export const CreateCircleRequest = Mutation.extend({
  // A circle's name is shown to everybody in it, and the same rule that governs
  // a person's display name governs it: collapsed whitespace, one to forty
  // characters of something.
  name: z.string().transform(normaliseDisplayName).refine(isValidDisplayName, 'not a usable name'),
  /**
   * A palette **token** — `sky`, not `#87ceeb`. Solid; no images (spec §5.2).
   *
   * `circles.color` says why in the column's own comment: "a token name
   * ('sky'), never a hex value: the palette is generated from the design source
   * and a stored hex would outlive the token it came from." Accepting a hex
   * here was a schema letting in the one value the table says must never
   * arrive.
   *
   * The shape, not the set. The circle palette is the design canvas's and is not
   * in `@circles/tokens` yet — those are the UI's roles, not a circle's choices —
   * and an enum written here would be a list invented in the wrong place.
   */
  color: z.string().regex(/^[a-z][a-z0-9]{1,23}$/, 'not a palette token'),
  /** From the device, not guessed by the server. */
  time_zone: Zone,
  cadence: z.enum(['weekly', 'fortnightly', 'monthly', 'two_monthly', 'none']).default('none'),
});
export type CreateCircleRequest = z.infer<typeof CreateCircleRequest>;

export const CreateCircleResponse = z.object({
  circle: CircleDto,
  /**
   * The invite secret, **returned once and never again**.
   *
   * Not a URL. The link is `${origin}${DEEP_LINK_ROUTES.join}#${secret}` and the
   * client is the only party that knows its own origin — a server-built URL
   * would hard-code one and be wrong in every preview deploy. The secret goes in
   * the *fragment*, which no server ever sees (§14); only its SHA-256 is stored,
   * so nothing can hand it back later.
   */
  invite_secret: z.string().min(43),
});
export type CreateCircleResponse = z.infer<typeof CreateCircleResponse>;

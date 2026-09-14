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
  /** A solid colour from the palette. No images (spec §5.2). */
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'not a colour'),
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

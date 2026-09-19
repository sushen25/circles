import {
  CreateCircleResponse,
  type CreateCircleRequest,
  type IdempotencyKey,
} from '@circles/contracts';

import { invokeFunction } from '../functions';

/**
 * `create-circle`: the circle and its first invite in one call (spec §5.1,
 * steps 4 and 5).
 *
 * Two typed inputs is the acceptance criterion, so this takes a name and a
 * cadence and nothing else from the person. The zone is the device's — the one
 * the organiser confirmed on the Your name screen — and the colour is the
 * palette's first token: spec §5.2 gives a circle a solid colour, and FirstCircle
 * deliberately asks for "nothing else". A colour choice belongs to circle
 * settings (S1-23).
 *
 * The idempotency key is the caller's, held for the life of the screen: a
 * person who cannot tell a timeout from a failure taps again, and the second
 * tap must return the first circle rather than make a second (ADR 0016).
 */
export const DEFAULT_CIRCLE_COLOR = 'sky';

export type Cadence = CreateCircleRequest['cadence'];

export interface CreateCircleOptions {
  name: string;
  cadence: Cadence;
  timeZone: string;
  idempotencyKey: IdempotencyKey;
}

export async function createCircle(options: CreateCircleOptions): Promise<CreateCircleResponse> {
  return await invokeFunction(
    'create-circle',
    {
      idempotency_key: options.idempotencyKey,
      name: options.name,
      color: DEFAULT_CIRCLE_COLOR,
      time_zone: options.timeZone,
      cadence: options.cadence,
    },
    CreateCircleResponse,
  );
}

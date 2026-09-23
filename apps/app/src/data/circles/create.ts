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
 * FirstCircle's two typed inputs are a name and a cadence, and nothing else
 * from the person: the colour is the palette's first token. CreateCircle — a
 * second circle, from the circles list — asks for the colour and "Where,
 * roughly" as well (S1-23). The zone is the device's either way — the one the
 * organiser confirmed on the Your name screen.
 *
 * The idempotency key is the caller's, held for the life of the screen: a
 * person who cannot tell a timeout from a failure taps again, and the second
 * tap must return the first circle rather than make a second (ADR 0016).
 */
export const DEFAULT_CIRCLE_COLOR = 'clay';

export type Cadence = CreateCircleRequest['cadence'];

export interface CreateCircleOptions {
  name: string;
  cadence: Cadence;
  timeZone: string;
  idempotencyKey: IdempotencyKey;
  /** A circle palette token. The first one when the person was not asked. */
  color?: string | undefined;
  /** "Where, roughly". Blank is no answer. */
  area?: string | undefined;
}

export async function createCircle(options: CreateCircleOptions): Promise<CreateCircleResponse> {
  return await invokeFunction(
    'create-circle',
    {
      idempotency_key: options.idempotencyKey,
      name: options.name,
      color: options.color ?? DEFAULT_CIRCLE_COLOR,
      time_zone: options.timeZone,
      cadence: options.cadence,
      ...(options.area === undefined || options.area.trim() === ''
        ? {}
        : { default_area: options.area.trim() }),
    },
    CreateCircleResponse,
  );
}

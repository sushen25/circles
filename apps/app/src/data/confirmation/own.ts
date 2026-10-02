import {
  ConfirmMeetupRequest,
  ConfirmMeetupResponse,
  EditConfirmationRequest,
  EditConfirmationResponse,
} from '@circles/contracts';
import { z } from 'zod';

import { authClient } from '../auth/client';
import { invokeFunction, newIdempotencyKey } from '../functions';
import type { ChasedAnswer } from './write';

/**
 * The organiser sets the final plan (ADR 0050): who a stretch works for, locking
 * in a time of their own, and editing a locked-in plan.
 *
 * Nothing here decides anything. `public.stretch_availability` answers who can
 * make a stretch by the engine's own rule, and `confirm-meetup` and
 * `edit-confirmation` hand the decision to the database, which refuses a time in
 * the past, off the half hour or too far ahead, and an answer that has landed
 * since the names on screen.
 */

const Reply = z.object({
  available: z.array(z.string()),
  cannot: z.array(z.string()),
  awaiting: z.array(z.string()),
  input_version: z.number().int().positive(),
  revision: z.number().int().positive(),
});

/** Who a stretch works for, as ids, with the version of the plan that was asked. */
export type Stretch = {
  /** In the engine's order, "I'm easy" included. */
  available: string[];
  /** Answered, and cannot make it. */
  cannot: string[];
  /** Has not answered. Never in either list above. */
  awaiting: string[];
  /** What a lock-in names, so an answer that lands after this is noticed. */
  inputVersion: number;
  revision: number;
};

/** The organiser's question: who does this stretch work for? Ids only, never a window. */
export async function stretchOf(planId: string, startsAt: string, endsAt: string): Promise<Stretch> {
  const { data, error } = await authClient().rpc('stretch_availability', {
    p_plan_id: planId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
  });
  if (error !== null) throw new Error('stretch_availability failed');
  const reply = Reply.parse(data);
  return {
    available: reply.available,
    cannot: reply.cannot,
    awaiting: reply.awaiting,
    inputVersion: reply.input_version,
    revision: reply.revision,
  };
}

export type ConfirmOwnTimeInput = {
  planId: string;
  /** Both ends as ISO instants. */
  startsAt: string;
  endsAt: string;
  /** The plan's `inputVersion` as `stretchOf` returned it with the names on screen. */
  expectedInputVersion: number;
  chasedAnswer: ChasedAnswer;
  placeName?: string | undefined;
  placeUrl?: string | undefined;
  note?: string | undefined;
};

/** Lock in a day and time the engine never offered. One idempotency key per tap (ADR 0016). */
export async function confirmOwnTime(input: ConfirmOwnTimeInput): Promise<ConfirmMeetupResponse> {
  return invokeFunction(
    'confirm-meetup',
    ConfirmMeetupRequest.parse({
      idempotency_key: newIdempotencyKey(),
      plan_id: input.planId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      expected_input_version: input.expectedInputVersion,
      chased_answer: input.chasedAnswer,
      place_name: input.placeName,
      place_url: input.placeUrl,
      note: input.note,
    }),
    ConfirmMeetupResponse,
  );
}

export type EditConfirmationInput = {
  planId: string;
  /** Both, for a move; neither to leave the time where it is. */
  startsAt?: string | undefined;
  endsAt?: string | undefined;
  /** Required with a new time. */
  expectedInputVersion?: number | undefined;
  /** Said whole: absent clears it. */
  placeName?: string | undefined;
  placeUrl?: string | undefined;
  note?: string | undefined;
};

/** Edit a locked-in plan: a move, or the place and note. One idempotency key per tap. */
export async function editConfirmation(
  input: EditConfirmationInput,
): Promise<EditConfirmationResponse> {
  return invokeFunction(
    'edit-confirmation',
    EditConfirmationRequest.parse({
      idempotency_key: newIdempotencyKey(),
      plan_id: input.planId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      expected_input_version: input.expectedInputVersion,
      place_name: input.placeName ?? null,
      place_url: input.placeUrl ?? null,
      note: input.note ?? null,
    }),
    EditConfirmationResponse,
  );
}

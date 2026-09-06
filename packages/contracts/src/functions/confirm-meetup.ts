import { z } from 'zod';

import { PlanId, CandidateId, ConfirmationId } from '../ids.js';
import { Mutation } from './shared.js';

/** `confirm-meetup` — Freshness check on the candidate, one active confirmation, freeze the times, enqueue confirmations and reminders. */
export const ConfirmMeetupRequest = Mutation.extend({ plan_id: PlanId, candidate_id: CandidateId });
export type ConfirmMeetupRequest = z.infer<typeof ConfirmMeetupRequest>;

export const ConfirmMeetupResponse = z.object({ confirmation_id: ConfirmationId });
export type ConfirmMeetupResponse = z.infer<typeof ConfirmMeetupResponse>;

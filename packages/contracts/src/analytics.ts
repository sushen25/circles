import { z } from 'zod';

import { CircleId, PlanId } from './ids.js';

/**
 * The analytics catalogue: every event the product may emit, with a versioned
 * payload schema. The client's `track()` and the server's `track-events`
 * function both validate against this, so an event that is not declared here
 * cannot be recorded (architecture §15).
 *
 * **Nothing in a payload may be a name, email, note, token or event title**
 * (spec §11.3). That is enforced structurally rather than by review: payloads
 * are strict objects built from a fixed vocabulary of identifiers, enums,
 * numbers and booleans, and `analytics.test.ts` fails if a schema ever accepts
 * a key that could carry a person's words.
 *
 * Bump `version` when a payload's meaning changes, so a query can tell the old
 * shape from the new one rather than silently mixing them.
 */

/** The only identifiers allowed in a payload. Both are opaque to a reader. */
const identifiers = {
  circle_id: CircleId.optional(),
  plan_id: PlanId.optional(),
};

type Shape = Record<string, z.ZodType>;

function event<S extends Shape>(version: number, shape: S = {} as S) {
  return { version, payload: z.strictObject({ ...identifiers, ...shape }) };
}

/** A count that is never a person's identity — "5 of 6 can make it". */
const count = z.int().nonnegative().max(10_000);

export const catalogue = {
  // --- identity -----------------------------------------------------------
  account_started: event(1),
  account_completed: event(1, { provider: z.enum(['apple', 'google', 'email']) }),
  account_claimed: event(1, {
    moment: z.enum(['after_answer', 'after_confirmed', 'after_attendance', 'settings']),
  }),
  session_missing_on_return: event(1),
  member_reattached: event(1, { source: z.enum(['list', 'email']) }),
  duplicate_member_removed: event(1),
  guest_started_circle: event(1),
  app_first_open_linked: event(1),

  // --- circles ------------------------------------------------------------
  circle_created: event(1),
  circle_invite_shared: event(1, { kind: z.enum(['link', 'sheet', 'copy']) }),
  circle_join_opened: event(1),
  circle_joined: event(1, { member_count: count.optional() }),

  // --- planning -----------------------------------------------------------
  plan_created: event(1, {
    mode: z.enum(['named', 'quiet']),
    window: z.enum(['tonight', 'weekend', 'next_week', 'custom']),
    used_defaults: z.boolean(),
  }),
  plan_shared: event(1),
  plan_edited: event(1, { invalidated_responses: z.boolean() }),
  plan_expired: event(1),
  plan_cancelled: event(1),
  plan_rescheduled: event(1),
  plan_another_started: event(1),

  // --- quiet ask ----------------------------------------------------------
  quiet_ask_created: event(1),
  quiet_interest_answered: event(1, { answer: z.enum(['yes', 'no']) }),
  quiet_threshold_reached: event(1, { threshold: count }),
  organiser_accepted: event(1, {
    role: z.enum(['initiator', 'volunteer', 'owner_fallback']),
  }),

  // --- availability -------------------------------------------------------
  availability_started: event(1),
  availability_submitted: event(1, {
    status: z.enum(['windows', 'flexible', 'none_work']),
    window_count: count.optional(),
  }),

  // --- scheduling and confirmation ---------------------------------------
  candidate_set_generated: event(1, { candidate_count: count, quorum_met: z.boolean() }),
  candidate_viewed: event(1, { role: z.enum(['organiser', 'member']) }),
  candidate_selected: event(1, { rank: count }),
  deadline_passed_action: event(1, {
    action: z.enum(['confirm_anyway', 'extend', 'cancel', 'nothing']),
  }),
  meetup_confirmed: event(1, { attending_count: count, invited_count: count }),
  organiser_chased: event(1, { answer: z.enum(['yes', 'no']) }),

  // --- outcome ------------------------------------------------------------
  outcome_reported: event(1, { outcome: z.enum(['happened', 'did_not_happen', 'unsure']) }),
  attendance_confirmed: event(1, { attended_count: count }),
  cadence_prompt_sent: event(1, {
    recipient_role: z.enum(['owner', 'member', 'take_turns']),
  }),

  // --- sharing and calendar ----------------------------------------------
  share_opened: event(1, { kind: z.enum(['invite', 'plan', 'confirmed', 'reminder']) }),
  calendar_add_opened: event(1, { surface: z.enum(['web', 'native']) }),
  ics_downloaded: event(1),

  // --- email --------------------------------------------------------------
  email_updates_offered: event(1),
  email_submitted: event(1),
  email_verified: event(1),
  email_subscription_changed: event(1, { enabled: z.boolean() }),
  email_delivery_result: event(1, {
    code: z.enum(['delivered', 'bounced', 'complained', 'deferred', 'failed']),
  }),

  // --- growth nudges ------------------------------------------------------
  app_nudge_shown: event(1, {
    moment: z.enum(['confirmed', 'reattached', 'second_response', 'after_attendance']),
  }),
  app_nudge_dismissed: event(1, {
    moment: z.enum(['confirmed', 'reattached', 'second_response', 'after_attendance']),
  }),
  app_nudge_tapped: event(1, {
    moment: z.enum(['confirmed', 'reattached', 'second_response', 'after_attendance']),
  }),

  // --- native, Slice 3 ----------------------------------------------------
  calendar_explanation_viewed: event(1),
  calendar_permission_result: event(1, { granted: z.boolean() }),
  calendar_overlay_used: event(1, { overridden_cells: count }),
  push_permission_result: event(1, { granted: z.boolean() }),
} as const;

export type EventName = keyof typeof catalogue;

export type EventPayload<E extends EventName> = z.infer<(typeof catalogue)[E]['payload']>;

/** The envelope `track-events` accepts. */
export const TrackedEvent = z.object({
  name: z.string(),
  version: z.int().positive(),
  occurred_at: z.iso.datetime({ offset: true }),
  properties: z.record(z.string(), z.unknown()),
});
export type TrackedEvent = z.infer<typeof TrackedEvent>;

/**
 * Key fragments that would make a payload carry a person's words. Checked by
 * the catalogue test against every declared payload, so this list is the
 * enforcement, not a guideline.
 */
export const FORBIDDEN_PAYLOAD_KEYS = [
  'name',
  'email',
  'note',
  'token',
  'title',
  'secret',
  'address',
  'phone',
  'message',
] as const;

/** Validate a payload against the catalogue. Returns null when it does not fit. */
export function validateEvent<E extends EventName>(
  name: E,
  payload: unknown,
): { name: E; version: number; properties: EventPayload<E> } | null {
  const entry = catalogue[name];
  const result = entry.payload.safeParse(payload);
  if (!result.success) return null;
  return { name, version: entry.version, properties: result.data as EventPayload<E> };
}

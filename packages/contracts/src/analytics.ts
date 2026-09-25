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
  circle_joined: event(1, {
    member_count: count.optional(),
    /**
     * Which door (ADR 0022): the circle's invite link, or a plan's. Optional
     * because the ingest hears from tabs opened before this existed, and
     * refusing their events would lose the joins it counts; an absent source is
     * one of those, and they could only have come through an invite.
     */
    source: z.enum(['invite', 'plan_link']).optional(),
  }),

  // --- planning -----------------------------------------------------------
  plan_created: event(1, {
    mode: z.enum(['named', 'quiet']),
    /**
     * Which preset the window came from. `next_two_weeks` is S1-22's: the
     * first-run plan asks about the next fourteen days (spec §5.1 step 7), and
     * the list had nowhere to put the one window every first plan uses — it
     * would have been recorded as `next_week`, which is a different question.
     * Widening an enum changes no existing event's meaning, so the version
     * stays.
     */
    window: z.enum(['tonight', 'weekend', 'next_week', 'next_two_weeks', 'custom']),
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
    /**
     * All five of the spec's outcomes (§5.5). It had three, and §5.5 asks for
     * "the share of flexible and more-notice responses" to be instrumented — so
     * the one it names was the one it could not record. Widening an enum
     * changes no existing event's meaning, so the version stays.
     */
    status: z.enum(['windows', 'flexible', 'none_work', 'more_notice', 'not_this_time']),
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
  /**
   * "Did you have to chase anyone outside the app?" (spec §5.10) — the three
   * answers the review screen offers and `meetup_confirmations.chased_answer`
   * stores. Version 1 said `yes | no`, which cannot tell one chased person from
   * several: the client would have had to throw the answer's one distinction
   * away to get it past the catalogue. A changed meaning, so a new version.
   */
  organiser_chased: event(2, { answer: z.enum(['none', 'one', 'more']) }),

  // --- outcome ------------------------------------------------------------
  /**
   * The four answers `Outcome` has (domain `confirmation/types.ts`, and the
   * `outcome_reports_outcome` check that stores them). An earlier version of
   * this line said `happened | did_not_happen | unsure`, which no outcome can
   * ever be: the client would have had to invent a value to get the event
   * past the catalogue, and `moved_outside` — "neither failure nor success"
   * — had nowhere to go at all.
   */
  outcome_reported: event(2, {
    outcome: z.enum(['happened', 'cancelled', 'moved_outside', 'not_sure']),
  }),
  attendance_confirmed: event(1, { attended_count: count }),
  /**
   * A member correcting "Going / Can't make it" on the confirmed screen, before
   * the meetup (spec §5.7). Not `attendance_confirmed`, which is the morning
   * after's "I was there" — a different question with a different metric.
   */
  attendance_updated: event(1, { status: z.enum(['going', 'cant']) }),
  /**
   * One cadence nudge decided and queued, recorded by the dispatcher (S2-04).
   * `recipient_role` is why that person: the circle's policy, or the owner as
   * the fallback when the policy found nobody (`NudgeRole` in the domain). The
   * enum was `owner | member | take_turns` until something first emitted it,
   * which named a role and two policies in one list; nothing had been recorded
   * under it, so the version stays.
   */
  cadence_prompt_sent: event(1, {
    recipient_role: z.enum(['owner', 'last_organiser', 'take_turns', 'owner_fallback']),
  }),

  // --- sharing and calendar ----------------------------------------------
  /**
   * Which message the sheet opened with (spec §5.8's list). `changed` and
   * `cancelled` are S1-26's: the paste-ready update after "Change the time" and
   * after a cancel. Widening an enum changes no existing event's meaning, so
   * the version stays.
   */
  share_opened: event(1, {
    kind: z.enum(['invite', 'plan', 'confirmed', 'reminder', 'changed', 'cancelled']),
  }),
  calendar_add_opened: event(1, { surface: z.enum(['web', 'native']) }),
  ics_downloaded: event(1),

  // --- email --------------------------------------------------------------
  email_updates_offered: event(1),
  email_submitted: event(1),
  email_verified: event(1),
  email_subscription_changed: event(1, { enabled: z.boolean() }),
  // "Emails about plans you organise" (ADR 0029): a person's own switch, not a
  // plan subscription, so it is not `email_subscription_changed`.
  organiser_email_changed: event(1, { enabled: z.boolean() }),
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

/**
 * The envelope `track-events` accepts.
 *
 * `event_id` is minted by whoever records the event, and it is what makes a
 * resend safe. The client buffers while offline and **puts a failed batch
 * back**, which includes the case where the insert committed and the response
 * was lost on the way home — so without an id per event, one flaky flush
 * inflates every funnel count it touched. The ingest inserts on conflict do
 * nothing, so the second arrival of an event is the same event.
 */
export const TrackedEvent = z.object({
  event_id: z.uuid(),
  name: z.string(),
  version: z.int().positive(),
  occurred_at: z.iso.datetime({ offset: true }),
  properties: z.record(z.string(), z.unknown()),
});
export type TrackedEvent = z.infer<typeof TrackedEvent>;

/**
 * The moments a growth nudge can be shown at, and the moments an account can be
 * claimed at, as one list.
 *
 * `nudge_states.moment` (migration 0006) is checked against exactly this union,
 * and the two live in different languages: if the catalogue gains a moment and
 * the constraint does not, the write fails at the database with a check
 * violation nobody expects. `analytics.test.ts` asserts this equals the union of
 * the catalogue's two enums, and `150_analytics.sql` asserts the constraint
 * holds the same values — so a new moment fails both halves and says where.
 */
export const NUDGE_MOMENTS = [
  'after_answer',
  'after_attendance',
  'after_confirmed',
  'confirmed',
  'reattached',
  'second_response',
  'settings',
] as const;

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

/** Whether a string names an event the catalogue declares. */
export function isEventName(name: string): name is EventName {
  return Object.hasOwn(catalogue, name);
}

/**
 * The ingest's version of `validateEvent`: **unknown keys are dropped rather
 * than refusing the event** (architecture §15).
 *
 * The two differ on purpose. `track()` runs in our own client, where an
 * undeclared key is a bug worth stopping for, so the payload is strict. The
 * ingest is reached by clients of every age — a browser tab open since before a
 * deploy, a phone that has not reloaded in a week — and refusing their whole
 * event because it carries a field a later version added loses the measurement
 * for the release the measurement is about.
 *
 * Dropping is safe because it happens *before* validation, not instead of it:
 * what survives is only the keys the catalogue declares, and it still has to
 * satisfy the strict schema. A key carrying somebody's words cannot be dropped
 * into the table by this path, because it is not dropped into anything.
 */
export function acceptEvent(
  name: string,
  payload: unknown,
): { name: EventName; version: number; properties: Record<string, unknown> } | null {
  if (!isEventName(name)) return null;
  const entry = catalogue[name];

  const declared = entry.payload.shape as Record<string, unknown>;
  const given = typeof payload === 'object' && payload !== null ? payload : {};
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(declared)) {
    if (Object.hasOwn(given, key)) kept[key] = (given as Record<string, unknown>)[key];
  }

  const result = entry.payload.safeParse(kept);
  if (!result.success) return null;
  return { name, version: entry.version, properties: result.data as Record<string, unknown> };
}

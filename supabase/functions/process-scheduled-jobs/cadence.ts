import { validateEvent } from '@circles/contracts';
import {
  type Circle,
  type EligibilityContext,
  type Instant,
  type LocalDate,
  type Member,
  type UserId,
  idempotencyKey,
  nudgeChoice,
  nudgeDueDate,
  nudgeHeld,
  occurrenceFor,
  recipientsFor,
  scheduleFor,
  zone,
} from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { sha256 } from '../_shared/hash.ts';
import { log } from '../_shared/logging.ts';
import { type MemberRow, circleOf, memberOf } from './context.ts';
import type { JobRow } from './drain.ts';

/**
 * The cadence nudge (spec §5.9, S2-04): when a circle falls due, one person is
 * asked to plan the next one.
 *
 * `about_time` is the one kind that belongs to a circle rather than a plan, so
 * it has its own context and its own pass, beside the plan kinds rather than
 * inside them. Every decision is the domain's — whether a nudge is owed and
 * for which due date (`nudgeDueDate`), who is asked and why (`nudgeChoice`),
 * on what and when (`recipientsFor`, `scheduleFor`) — and the database's half
 * is `public.dispatch_prompt_cadence`, which records the decision once per due
 * date and writes its jobs in the same transaction.
 */

type CircleContextRow = {
  circle: Record<string, unknown>;
  members: (MemberRow & { muted_organiser_email: boolean })[];
  has_open_plan: boolean;
  last_organiser_id: string | null;
  last_happened_attendees: string[];
  prompted_for: string | null;
  push_user_ids: string[];
};

export type CircleContext = {
  readonly circle: Circle;
  /** Every membership row, removed ones included (take turns walks on from them). */
  readonly members: readonly Member[];
  readonly hasOpenPlan: boolean;
  readonly lastOrganiserId: UserId | undefined;
  readonly lastHappenedAttendees: readonly UserId[];
  /** The latest due date already decided, if any. */
  readonly promptedFor: string | undefined;
  readonly eligibility: EligibilityContext;
  readonly zoneOf: (userId: string) => ReturnType<typeof zone>;
};

export async function loadCircleContext(
  service: Db,
  circleId: string,
): Promise<CircleContext | null> {
  const { data, error } = await service.rpc('dispatch_circle_context', {
    p_circle_id: circleId,
  });
  if (error !== null) throw error;
  if (data === null) return null;

  const row = data as unknown as CircleContextRow;
  const circle = circleOf(row.circle);
  const members = row.members.map(memberOf);
  const pushes = new Set(row.push_user_ids);
  const organiserEmailOff = new Set(
    row.members.filter((m) => m.muted_organiser_email).map((m) => m.user_id),
  );
  const zones = new Map(row.members.map((m) => [m.user_id, zone(m.time_zone)] as const));
  const lastOrganiserId = (row.last_organiser_id ?? undefined) as UserId | undefined;
  const lastHappenedAttendees = row.last_happened_attendees as UserId[];

  return {
    circle,
    members,
    hasOpenPlan: row.has_open_plan,
    lastOrganiserId,
    lastHappenedAttendees,
    promptedFor: row.prompted_for ?? undefined,
    // No plan: `about_time` is answered before one is consulted, and every
    // plan-scoped audience answers nobody without one.
    eligibility: {
      circle,
      members,
      participantIds: [],
      responses: [],
      hasPushDevice: (userId) => pushes.has(userId),
      mutedOrganiserEmail: (userId) => organiserEmailOff.has(userId),
      nudge: { lastHappenedAttendees, lastOrganiserId },
    },
    zoneOf: (userId) => zones.get(userId) ?? circle.zone,
  };
}

/**
 * A due `about_time` job's circle, read now, and why it should not go if it
 * should not — the sender's eighth check. Any other kind is passed straight
 * through with no circle. `circles` caches the reads for one run.
 */
export async function nudgeAtSend(
  service: Db,
  job: { readonly kind: string; readonly circle_id: string | null; readonly user_id: string },
  circles: Map<string, CircleContext | null>,
  now: Instant,
): Promise<{ circle: CircleContext | null; held?: string | undefined }> {
  if (job.kind !== 'about_time' || job.circle_id === null) return { circle: null };
  if (!circles.has(job.circle_id)) {
    circles.set(job.circle_id, await loadCircleContext(service, job.circle_id));
  }
  const circle = circles.get(job.circle_id) ?? null;
  if (circle === null) return { circle };
  return {
    circle,
    held: nudgeHeld({
      circle: circle.circle,
      member: circle.members.find((m) => m.userId === job.user_id),
      now,
      hasOpenPlan: circle.hasOpenPlan,
    }),
  };
}

/** The job rows one nudge becomes: at most one person, on whichever channel reaches them. */
async function nudgeRows(
  service: Db,
  context: CircleContext,
  dueDate: LocalDate,
  now: Instant,
  requestId: string,
): Promise<JobRow[]> {
  const occurrence = occurrenceFor('about_time', { circleId: context.circle.id, dueDate });
  const rows: JobRow[] = [];

  for (const recipient of recipientsFor('about_time', context.eligibility)) {
    const scheduled = new Date(
      scheduleFor('about_time', now, context.zoneOf(recipient.userId)),
    ).toISOString();
    const common = {
      kind: 'about_time',
      plan_id: null,
      plan_revision: null,
      circle_id: context.circle.id,
      scheduled_for: scheduled,
    };

    if (recipient.channel === 'push') {
      rows.push({
        ...common,
        channel: 'push',
        user_id: recipient.userId,
        contact_id: null,
        idempotency_key: await idempotencyKey({
          channel: 'push',
          recipientId: recipient.userId,
          kind: 'about_time',
          occurrence,
        }),
      });
      continue;
    }

    // An organiser kind: addressed to the person's own confirmed address, made
    // a contact so a bounce suppresses it like any other (ADR 0027). The nudge
    // needs no subscription — there is no plan to subscribe to.
    const { data, error } = await service.rpc('dispatch_organiser_contact', {
      p_user_id: recipient.userId,
    });
    if (error !== null) throw error;
    const contactId = (data as string | null) ?? null;
    if (contactId === null) {
      log('warn', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: 'organiser_unreachable',
        reason: 'about_time',
      });
      continue;
    }
    rows.push({
      ...common,
      channel: 'email',
      user_id: null,
      contact_id: contactId,
      idempotency_key: await idempotencyKey({
        channel: 'email',
        recipientId: contactId,
        kind: 'about_time',
        occurrence,
      }),
    });
  }

  return rows;
}

/** The analytics row's id, from the decision, so a replay lands on the row already written. */
async function eventIdOf(circleId: string, dueDate: string): Promise<string> {
  const hex = [...(await sha256(`cadence_prompt_sent:${circleId}:${dueDate}`))]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type CadenceResult = { prompted: number; nudgesQueued: number };

/**
 * One pass over the circles `dispatch_timed_work` named as possibly due.
 *
 * For each, the domain says whether a nudge is owed now and for which due
 * date; a due date already decided is left alone; otherwise the rule picks the
 * one person — or nobody, which is recorded too — and the decision and its
 * jobs are written together. `cadence_prompt_sent` is recorded only for a
 * decision that is new and asked somebody: it measures nudges, not sweeps.
 */
export async function cadenceWork(
  service: Db,
  circleIds: readonly string[],
  requestId: string,
  now: Instant,
  deadline: () => boolean,
): Promise<CadenceResult> {
  const result: CadenceResult = { prompted: 0, nudgesQueued: 0 };

  for (const circleId of circleIds) {
    if (deadline()) return result;
    const context = await loadCircleContext(service, circleId);
    if (context === null) continue;

    const dueDate = nudgeDueDate(context.circle, now, context.hasOpenPlan);
    if (dueDate === undefined) continue;
    if (context.promptedFor !== undefined && context.promptedFor >= dueDate) continue;

    const choice = nudgeChoice({
      circle: context.circle,
      members: context.members,
      lastHappenedAttendees: context.lastHappenedAttendees,
      lastOrganiserId: context.lastOrganiserId,
    });
    const rows =
      choice === undefined ? [] : await nudgeRows(service, context, dueDate, now, requestId);

    const { data, error } = await service.rpc('dispatch_prompt_cadence', {
      p_circle_id: circleId,
      p_due_date: dueDate,
      p_user_id: choice?.userId ?? null,
      p_recipient_role: choice?.role ?? null,
      p_jobs: rows,
    });
    if (error !== null) throw error;
    // Null: another run decided this due date first, or a plan opened between
    // the read and the write. Either way, nothing of ours was written.
    if (data === null) continue;

    result.prompted += 1;
    result.nudgesQueued += (data as number | null) ?? 0;
    if (choice === undefined) continue;

    const accepted = validateEvent('cadence_prompt_sent', {
      circle_id: circleId,
      recipient_role: choice.role,
    });
    if (accepted === null) continue;
    const { circle_id: trackedCircle, ...properties } = accepted.properties;
    const { error: tracked } = await service.rpc('record_events', {
      p_rows: [
        {
          event_id: await eventIdOf(circleId, dueDate),
          event_name: accepted.name,
          schema_version: accepted.version,
          user_id: null,
          anonymous_id: null,
          circle_id: trackedCircle ?? circleId,
          plan_id: null,
          properties,
          occurred_at: new Date(now).toISOString(),
        },
      ],
    });
    // The nudge is decided and queued; a lost measurement must not undo it or
    // stop the rest of the pass. Said out loud instead.
    if (tracked !== null) {
      log('warn', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: 'analytics_failed',
        reason: 'cadence_prompt_sent',
      });
    }
  }

  return result;
}

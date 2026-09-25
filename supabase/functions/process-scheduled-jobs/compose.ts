import { brand } from '@circles/config';
import { type Instant, fromISO, weeksSince } from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { optional } from '../_shared/env.ts';
import type { EmailInput } from '../_shared/email/types.ts';
import {
  issuePreferencesToken,
  issueReentryToken,
  issueVerificationToken,
} from '../_shared/tokens.ts';
import type { CircleContext } from './cadence.ts';
import type { PlanContext } from './context.ts';
import type { DueJob } from './send.ts';

/**
 * One due job, turned into the thing S1-19's `render` takes.
 *
 * Every token is minted here, at send time, for the one contact the letter is
 * going to (ADR 0020, ADR 0025). A token that cannot be minted is not a
 * failure: it means there is nothing left to write to — the contact was
 * verified by another link, removed by its owner, or has left the circle — so
 * this answers a **reason to skip** rather than throwing.
 */

/** Why there is nothing to send. Always a code; never a sentence. */
export type Skip = { readonly skip: string };

function origin(): string {
  // The same variable `generate-ics` reads. Absent, links fall back to the
  // brand's own host, which is right in production and is why a local stack
  // sends links that point at it (a known gap; see the PR's testing notes).
  return optional('EXPO_PUBLIC_APP_ORIGIN') ?? `https://${brand.domain}`;
}

function goingCount(context: PlanContext): number {
  const confirmationId = context.confirmation?.id;
  if (confirmationId === undefined) return 0;
  return (context.eligibility.attendance ?? []).filter(
    (a) => a.confirmationId === confirmationId && a.status === 'going',
  ).length;
}

/**
 * The single-use way back in, or null for a saved place — and a **skip** when
 * the contact's owner is no longer in the circle.
 *
 * `issue_reentry_token` raises `not_a_member` for exactly that, and it is not a
 * fault: the person was removed, so the letter has nowhere to take them and
 * should not go. Treated as a failure it became `db:P0001` in `last_error` and
 * counted in the health summary as something broken (review round 1).
 */
async function reentryOrSkip(
  service: Db,
  circleId: string,
  contactId: string,
): Promise<string | null | Skip> {
  try {
    return await issueReentryToken(service, circleId, contactId);
  } catch (thrown) {
    const message = String((thrown as { message?: unknown }).message ?? '');
    if (message.includes('not_a_member')) return { skip: 'not_a_member' };
    if (message.includes('no_verified_contact')) return { skip: 'contact_unverified' };
    throw thrown;
  }
}

/**
 * The cadence nudge, which is about a circle and has no plan: no short code,
 * no tokens — its one link is the circle's home, where the person is signed in
 * (spec §5.8: organiser letters carry no stop link) — and "about a month"
 * worked out from the circle's last meetup now, in its zone.
 *
 * Answered before the plan kinds are, because every one of them would say
 * `plan_gone` for a job with no plan, and a cadence nudge that looks done and
 * sends nothing is exactly the trap S1-20 left written on this ticket.
 */
function aboutTimeInput(circle: CircleContext | null, now: Instant): EmailInput | Skip {
  if (circle === null) return { skip: 'circle_gone' };
  const lastMet = circle.circle.lastMetAt;
  if (lastMet === undefined) return { skip: 'no_longer_due' };
  return {
    kind: 'about_time',
    origin: origin(),
    circleName: circle.circle.name,
    circleId: circle.circle.id,
    weeksSince: weeksSince(lastMet, now, circle.circle.zone),
  };
}

export async function inputFor(
  service: Db,
  job: DueJob,
  context: PlanContext | null,
  /** For `about_time` alone, the circle it is about. */
  circle: CircleContext | null = null,
  now: Instant = fromISO(new Date().toISOString()),
): Promise<EmailInput | Skip> {
  if (job.kind === 'verify_email') {
    const verifyToken = await issueVerificationToken(service, job.contact_id);
    if (verifyToken === null) return { skip: 'nothing_to_verify' };
    return { kind: 'verify_email', origin: origin(), verifyToken };
  }

  if (job.kind === 'about_time') return aboutTimeInput(circle, now);

  if (context === null || job.plan_short_code === null || job.circle_name === null) {
    return { skip: 'plan_gone' };
  }

  const toOrganiser = {
    origin: origin(),
    circleName: job.circle_name,
    planCode: job.plan_short_code,
  };

  switch (job.kind) {
    case 'options_ready': {
      const best = context.bestCandidate;
      // Not a skip: the set is stale and the recalculation that will rebuild it
      // is this same run's third phase. Skipping would spend the job's
      // idempotency key for this revision, and the organiser would never be
      // told the options were ready at all (review round 1).
      if (best === null) return { skip: 'retry:no_candidates' };
      return {
        kind: 'options_ready',
        ...toOrganiser,
        bestStart: fromISO(best.startsAt),
        zone: context.planZone,
        availableCount: best.availableCount,
      };
    }
    case 'replies_closed': {
      // Which letter is decided by who it is *for*, not by the plan now: the
      // recipient was fixed when the job was written, and the organiser can
      // change while quiet hours hold it (review round 4). The organiser gets
      // theirs; the owner gets the fallback (spec §5.4.5) only while nobody
      // organises; anybody else — an organiser since removed, an owner since
      // superseded — gets nothing.
      if (context.organiserUserId !== undefined) {
        return job.user_id === context.organiserUserId
          ? { kind: 'replies_closed', ...toOrganiser }
          : { skip: 'not_the_organiser' };
      }
      if (
        context.eligibility.plan?.mode === 'quiet' &&
        job.user_id === context.eligibility.circle.ownerUserId
      ) {
        return { kind: 'replies_closed', ...toOrganiser, toOwner: true };
      }
      return { skip: 'not_the_organiser' };
    }
    case 'did_it_happen': {
      const confirmation = context.confirmation ?? context.supersededConfirmation;
      if (confirmation === null) return { skip: 'no_confirmation' };
      return {
        kind: 'did_it_happen',
        ...toOrganiser,
        start: fromISO(confirmation.starts_at),
        zone: context.planZone,
      };
    }
    // The quiet ask's initiator, at their own address (ADR 00XX). The job was
    // addressed from `dispatch_quiet_audience`; nothing here reads who asked.
    // An ask somebody has already taken on, or that has closed, no longer
    // needs its initiator to pick the time.
    case 'threshold_initiator':
      if (context.organiserUserId !== undefined) return { skip: 'organiser_taken' };
      return { kind: 'threshold_initiator', ...toOrganiser };
    case 'quiet_expired':
      if (job.circle_id === null) return { skip: 'plan_gone' };
      return {
        kind: 'quiet_expired',
        origin: toOrganiser.origin,
        circleName: toOrganiser.circleName,
        circleId: job.circle_id,
      };
    default:
      break;
  }

  // The plan-update kinds. Both links are minted for this letter and for this
  // contact; a null preferences token means the contact is not verified any
  // more, and a null re-entry token means a saved place, which simply renders
  // without the line.
  const prefsToken = await issuePreferencesToken(service, job.contact_id);
  if (prefsToken === null) return { skip: 'contact_unverified' };
  const reentry =
    job.circle_id === null ? null : await reentryOrSkip(service, job.circle_id, job.contact_id);
  if (reentry !== null && typeof reentry === 'object') return reentry;
  const reentryToken = reentry;
  const toSubscriber = { ...toOrganiser, prefsToken, reentryToken };

  switch (job.kind) {
    case 'locked_in': {
      const confirmation = context.confirmation;
      if (confirmation === null) return { skip: 'no_confirmation' };
      return {
        kind: 'locked_in',
        ...toSubscriber,
        start: fromISO(confirmation.starts_at),
        end: fromISO(confirmation.ends_at),
        zone: context.planZone,
        ...(confirmation.place_name === null ? {} : { placeName: confirmation.place_name }),
        ...(confirmation.note === null ? {} : { note: confirmation.note }),
        ...(context.organiserName === undefined ? {} : { organiserName: context.organiserName }),
      };
    }
    case 'changed': {
      const previous = context.supersededConfirmation;
      if (previous === null) return { skip: 'no_confirmation' };
      return {
        kind: 'changed',
        ...toSubscriber,
        zone: context.planZone,
        change: 'reopened',
        previousStart: fromISO(previous.starts_at),
      };
    }
    case 'cancelled': {
      const confirmation = context.confirmation ?? context.supersededConfirmation;
      const note = context.cancelNote;
      return {
        kind: 'cancelled',
        ...toSubscriber,
        zone: context.planZone,
        ...(confirmation === null ? {} : { start: fromISO(confirmation.starts_at) }),
        ...(note === undefined ? {} : { note }),
        ...(context.organiserName === undefined ? {} : { organiserName: context.organiserName }),
      };
    }
    case 'reminder': {
      const confirmation = context.confirmation;
      if (confirmation === null) return { skip: 'no_confirmation' };
      return {
        kind: 'reminder',
        ...toSubscriber,
        start: fromISO(confirmation.starts_at),
        zone: context.planZone,
        ...(confirmation.place_name === null ? {} : { placeName: confirmation.place_name }),
        goingCount: goingCount(context),
      };
    }
    case 'did_it_happen_participant': {
      const confirmation = context.confirmation ?? context.supersededConfirmation;
      if (confirmation === null) return { skip: 'no_confirmation' };
      return {
        kind: 'did_it_happen_participant',
        ...toSubscriber,
        start: fromISO(confirmation.starts_at),
        zone: context.planZone,
      };
    }
    default:
      return { skip: 'unsupported_kind' };
  }
}

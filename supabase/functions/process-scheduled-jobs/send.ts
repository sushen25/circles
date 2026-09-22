import { brand } from '@circles/config';
import { fromISO } from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { optional } from '../_shared/env.ts';
import { EmailSendError, sendEmail } from '../_shared/email/resend.ts';
import { render } from '../_shared/email/render.tsx';
import type { EmailInput } from '../_shared/email/types.ts';
import { log } from '../_shared/logging.ts';
import {
  issuePreferencesToken,
  issueReentryToken,
  issueVerificationToken,
} from '../_shared/tokens.ts';
import { type PlanContext, loadContext } from './context.ts';
import { classify } from './drain.ts';

/**
 * Sending what is due.
 *
 * Four checks happen here and not one of them could have happened when the job
 * was written, which is the reason this phase exists at all rather than the
 * drain simply calling Resend:
 *
 *   * the **contact** may have been suppressed since (spec §9's "permanent
 *     failure → skipped" is evaluated at send time, S1-18);
 *   * the **plan** may be over — a verification queued while a plan was live
 *     is still `scheduled` after it is cancelled, and sending it is a letter
 *     about a meetup that is not happening;
 *   * the **address** may already have had this message through a sibling
 *     contact (spec §9: "one verified address on multiple guest memberships in
 *     one plan: one copy per event");
 *   * the **token** may have nothing left to mint — verified by another link,
 *     removed by its owner (ADR 0020).
 *
 * All four are `skipped`, not `failed`: nothing went wrong.
 */

/** 1, 5, 30 minutes, then give up (ticket S1-20 step 4). */
const BACKOFF_MINUTES = [1, 5, 30];

export type DueJob = {
  readonly id: string;
  readonly kind: string;
  readonly contact_id: string;
  readonly user_id: string;
  readonly plan_id: string | null;
  readonly plan_revision: number | null;
  readonly idempotency_key: string;
  readonly attempt_count: number;
  readonly email: string;
  readonly contact_status: string;
  readonly plan_state: string | null;
  readonly plan_short_code: string | null;
  readonly circle_id: string | null;
  readonly circle_name: string | null;
  readonly superseded: boolean;
};

export type SendResult = { sent: number; skipped: number; failed: number; retried: number };

function origin(): string {
  return optional('EXPO_PUBLIC_APP_ORIGIN') ?? `https://${brand.domain}`;
}

/**
 * States in which a letter about this plan is a letter about something that is
 * over. `cancelled` is the exception that proves it: "Thursday is off" is
 * exactly the message a cancelled plan owes people.
 */
function planIsPast(job: DueJob): boolean {
  if (job.kind === 'cancelled') return false;
  return (
    job.plan_state === 'cancelled' || job.plan_state === 'expired' || job.plan_state === 'completed'
  );
}

function goingCount(context: PlanContext): number {
  const confirmationId = context.confirmation?.id;
  if (confirmationId === undefined) return 0;
  return context.eligibility.attendance === undefined
    ? 0
    : context.eligibility.attendance.filter(
        (a) => a.confirmationId === confirmationId && a.status === 'going',
      ).length;
}

/**
 * The renderer's input for one job.
 *
 * Returns a **reason** rather than an input when there is nothing to send:
 * a plan-update kind whose preferences token cannot be minted has no contact
 * left to write to, and the confirmation a kind describes may simply be gone.
 */
async function inputFor(
  service: Db,
  job: DueJob,
  context: PlanContext | null,
): Promise<EmailInput | { skip: string }> {
  if (job.kind === 'verify_email') {
    const verifyToken = await issueVerificationToken(service, job.contact_id);
    if (verifyToken === null) return { skip: 'nothing_to_verify' };
    return { kind: 'verify_email', origin: origin(), verifyToken };
  }

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
      if (best === null) return { skip: 'no_candidates' };
      return {
        kind: 'options_ready',
        ...toOrganiser,
        bestStart: fromISO(best.startsAt),
        zone: context.planZone,
        availableCount: best.availableCount,
      };
    }
    case 'replies_closed':
      return { kind: 'replies_closed', ...toOrganiser };
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
    default:
      break;
  }

  // The plan-update kinds. Both links are minted for this letter and for this
  // contact (ADR 0020, ADR 0025); a null preferences token means the contact is
  // not verified any more, and a null re-entry token means a saved place, which
  // simply renders without the line.
  const prefsToken = await issuePreferencesToken(service, job.contact_id);
  if (prefsToken === null) return { skip: 'contact_unverified' };
  const reentryToken =
    job.circle_id === null ? null : await issueReentryToken(service, job.circle_id, job.contact_id);
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

async function record(
  service: Db,
  id: string,
  outcome: string,
  error?: string,
  providerMessageId?: string,
  nextAttemptAt?: string,
): Promise<void> {
  const { error: failure } = await service.rpc('dispatch_job_result', {
    p_id: id,
    p_outcome: outcome,
    p_error: error ?? null,
    p_provider_message_id: providerMessageId ?? null,
    p_next_attempt_at: nextAttemptAt ?? null,
  });
  if (failure !== null) throw failure;
}

export async function send(
  service: Db,
  jobs: readonly DueJob[],
  requestId: string,
  deadline: () => boolean,
): Promise<SendResult> {
  const result: SendResult = { sent: 0, skipped: 0, failed: 0, retried: 0 };
  const contexts = new Map<string, PlanContext | null>();

  for (const job of jobs) {
    if (deadline()) break;

    const skip = async (reason: string): Promise<void> => {
      await record(service, job.id, 'skipped', reason);
      result.skipped += 1;
      log('info', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: 'job_skipped',
        reason,
        contact_id: job.contact_id,
      });
    };

    // A bounce that lands after the job was written leaves it `scheduled`.
    // Checked for every kind, including `verify_email`: a suppressed address
    // is never written to again, and re-verifying it is exactly the automatic
    // reactivation spec §9 forbids.
    if (job.contact_status === 'suppressed') {
      await skip('contact_suppressed');
      continue;
    }
    // Every other kind needs a verified contact. `verify_email` is the one
    // that does not — it is the letter that makes a contact verified, and its
    // contact is `pending` by definition.
    if (job.kind !== 'verify_email' && job.contact_status !== 'verified') {
      await skip('contact_pending');
      continue;
    }
    if (planIsPast(job)) {
      await skip('plan_finished');
      continue;
    }
    if (job.superseded) {
      await skip('duplicate_address');
      continue;
    }

    try {
      if (job.plan_id !== null && !contexts.has(job.plan_id)) {
        contexts.set(job.plan_id, await loadContext(service, job.plan_id));
      }
      const context = job.plan_id === null ? null : (contexts.get(job.plan_id) ?? null);

      const input = await inputFor(service, job, context);
      if ('skip' in input) {
        await skip(input.skip);
        continue;
      }

      const email = await render(input);
      const { providerMessageId } = await sendEmail(
        { to: job.email, ...email, tags: { kind: job.kind } },
        { contactId: job.contact_id, requestId, idempotencyKey: job.idempotency_key },
      );
      await record(service, job.id, 'sent', undefined, providerMessageId);
      result.sent += 1;
    } catch (thrown) {
      const retryable = thrown instanceof EmailSendError && thrown.retryable;
      const code = thrown instanceof EmailSendError ? thrown.code : classify(thrown);
      const wait = BACKOFF_MINUTES[job.attempt_count];

      if (retryable && wait !== undefined) {
        await record(
          service,
          job.id,
          'retry',
          code,
          undefined,
          new Date(Date.now() + wait * 60_000).toISOString(),
        );
        result.retried += 1;
      } else {
        await record(service, job.id, 'failed', code);
        result.failed += 1;
      }
      log(retryable ? 'warn' : 'error', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: retryable ? 'job_retried' : 'job_failed',
        reason: code,
        contact_id: job.contact_id,
      });
    }
  }

  return result;
}

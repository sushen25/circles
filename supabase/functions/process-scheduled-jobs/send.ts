import {
  type NotificationKind,
  type PlanState,
  isTerminal,
  notificationSpec,
} from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { EmailSendError, sendEmail } from '../_shared/email/resend.ts';
import { render } from '../_shared/email/render.tsx';
import { log } from '../_shared/logging.ts';
import { inputFor } from './compose.ts';
import { type PlanContext, loadContext } from './context.ts';
import { classify } from './drain.ts';

/**
 * Sending what is due.
 *
 * Five checks happen here and not one of them could have happened when the job
 * was written, which is the reason this phase exists at all rather than the
 * drain simply calling Resend:
 *
 *   * the **contact** may have been suppressed since (spec §9's "permanent
 *     failure → skipped" is evaluated at send time, S1-18);
 *   * the **consent** may have been withdrawn since. A reminder is written the
 *     moment a meetup is confirmed and waits days; "Stop emails for this
 *     meetup" withdraws the subscription and touches no job, so a stop link
 *     that did not stop a queued letter would not be one (spec §5.8);
 *   * the **plan** may be over — a verification queued while a plan was live
 *     is still `scheduled` after it is cancelled, and sending it is a letter
 *     about a meetup that is not happening;
 *   * the **address** may already have had this message through a sibling
 *     contact (spec §9: "one verified address on multiple guest memberships in
 *     one plan: one copy per event");
 *   * the **token** may have nothing left to mint — verified by another link,
 *     removed by its owner (ADR 0020).
 *
 * All five are `skipped`, not `failed`: nothing went wrong.
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
  /** Whether `private.email_recipients_for` still names this contact, now. */
  readonly subscribed: boolean;
  readonly plan_state: string | null;
  readonly plan_short_code: string | null;
  readonly circle_id: string | null;
  readonly circle_name: string | null;
  readonly superseded: boolean;
};

export type SendResult = { sent: number; skipped: number; failed: number; retried: number };

/**
 * States in which a letter about this plan is a letter about something that is
 * over. `cancelled` is the exception that proves it: "Thursday is off" is
 * exactly the message a cancelled plan owes people.
 */
function planIsPast(job: DueJob): boolean {
  if (job.kind === 'cancelled') return false;
  // `isTerminal` is the domain's, over `TERMINAL_STATES`. Spelling the three
  // states out here is the shape that goes stale the day a fourth is added.
  return job.plan_state !== null && isTerminal(job.plan_state as PlanState);
}

/**
 * Whether this kind may only go to somebody with a live per-plan subscription.
 *
 * The domain's table, not a list here: `emailNeedsSubscription` is what makes
 * "being in a circle is not consent" a rule rather than a habit, and the
 * organiser kinds are false for review C6's reason.
 */
function needsSubscription(kind: string): boolean {
  return notificationSpec(kind as NotificationKind).emailNeedsSubscription;
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

/** The next attempt for a job that has already failed this often, or null at the end. */
function backoff(attempts: number): string | null {
  const wait = BACKOFF_MINUTES[attempts];
  return wait === undefined ? null : new Date(Date.now() + wait * 60_000).toISOString();
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

    const finish = async (
      outcome: 'skipped' | 'retried' | 'failed',
      reason: string,
      nextAttemptAt?: string,
    ): Promise<void> => {
      await record(
        service,
        job.id,
        outcome === 'retried' ? 'retry' : outcome,
        reason,
        undefined,
        nextAttemptAt,
      );
      result[outcome] += 1;
      log(outcome === 'failed' ? 'error' : 'info', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: `job_${outcome}`,
        reason,
        contact_id: job.contact_id,
      });
    };

    // A bounce that lands after the job was written leaves it `scheduled`.
    // Checked for every kind, including `verify_email`: a suppressed address is
    // never written to again, and re-verifying it is exactly the automatic
    // reactivation spec §9 forbids.
    if (job.contact_status === 'suppressed') {
      await finish('skipped', 'contact_suppressed');
      continue;
    }
    // Every other kind needs a verified contact. `verify_email` is the one that
    // does not — it is the letter that makes a contact verified, and its
    // contact is `pending` by definition.
    if (job.kind !== 'verify_email' && job.contact_status !== 'verified') {
      await finish('skipped', 'contact_pending');
      continue;
    }
    if (needsSubscription(job.kind) && !job.subscribed) {
      await finish('skipped', 'subscription_withdrawn');
      continue;
    }
    if (planIsPast(job)) {
      await finish('skipped', 'plan_finished');
      continue;
    }
    if (job.superseded) {
      await finish('skipped', 'duplicate_address');
      continue;
    }

    try {
      if (job.plan_id !== null && !contexts.has(job.plan_id)) {
        contexts.set(job.plan_id, await loadContext(service, job.plan_id));
      }
      const context = job.plan_id === null ? null : (contexts.get(job.plan_id) ?? null);

      const input = await inputFor(service, job, context);
      if ('skip' in input) {
        // A `retry:` reason is a state that will resolve itself — the options
        // set is stale and this same run rebuilds it. Skipping would spend the
        // job's idempotency key, and there is one per revision, so the
        // organiser would never be told at all.
        if (input.skip.startsWith('retry:')) {
          const reason = input.skip.slice('retry:'.length);
          const next = backoff(job.attempt_count);
          if (next === null) await finish('failed', reason);
          else await finish('retried', reason, next);
        } else {
          await finish('skipped', input.skip);
        }
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
      const next = retryable ? backoff(job.attempt_count) : null;
      if (next === null) await finish('failed', code);
      else await finish('retried', code, next);
    }
  }

  return result;
}

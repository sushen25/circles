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
  /** Whether its owner is still an active member — one of that answer's three parts. */
  readonly member_active: boolean;
  readonly plan_state: string | null;
  /** The revision the plan is on **now**, which the job's may be behind. */
  readonly plan_current_revision: number | null;
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
 * The kinds whose whole content belongs to one revision of the question.
 *
 * `options_ready` is a candidate set and `deadline_approaching` is a deadline;
 * both are answers to the question the plan was asking at the revision the job
 * was stamped with. When the plan has moved past it — an edit, a reopen — the
 * message is about a question nobody is being asked any more, and sending it
 * from the *current* context would render the new revision's options under the
 * old revision's key, so the new revision's own event later writes a second
 * job with the same words (review round 3).
 *
 * Not `locked_in`, `reminder` or the two morning-after letters: a revision
 * change supersedes their confirmation, and `dispatch_cancel_pending` takes
 * them back. Not `cancelled`, whose revision never moves. Not `changed`, which
 * is *about* the revision having moved.
 */
const REVISION_SCOPED: readonly string[] = ['options_ready', 'deadline_approaching'];

function revisionMovedOn(job: DueJob): boolean {
  if (!REVISION_SCOPED.includes(job.kind)) return false;
  return (
    job.plan_revision !== null &&
    job.plan_current_revision !== null &&
    job.plan_current_revision > job.plan_revision
  );
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

/**
 * What makes two jobs the same letter to the same mailbox.
 *
 * The same tuple `dispatch_claim_due` partitions on, with the address in place
 * of the contact. `changed` and `verify_email` are excluded there and are
 * excluded here for the same reason: both can legitimately occur twice within
 * one revision, keyed by change id and verification id, and collapsing them is
 * how nobody gets told the venue moved.
 */
function copyKey(job: DueJob): string {
  if (job.kind === 'changed' || job.kind === 'verify_email') return `${job.id}`;
  return [job.kind, job.plan_id ?? '', job.plan_revision ?? '', job.email].join('\u0000');
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
  /**
   * Addresses this run has already written to about this exact message.
   *
   * In memory for the length of one run and nowhere else: it holds addresses,
   * which is why it never reaches a row or a log line. The database half of
   * the same rule is `dispatch_claim_due`'s `superseded`, which covers the
   * copies sent by earlier runs.
   */
  const alreadyGone = new Set<string>();

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
      // `email_recipients_for` is one answer with three conditions in it.
      // Somebody who has left the circle withdrew nothing, and saying they did
      // is a wrong story on S4-06's screen.
      await finish('skipped', job.member_active ? 'subscription_withdrawn' : 'not_a_member');
      continue;
    }
    if (planIsPast(job)) {
      await finish('skipped', 'plan_finished');
      continue;
    }
    if (revisionMovedOn(job)) {
      await finish('skipped', 'revision_moved_on');
      continue;
    }
    // Already gone to this address, in an earlier run.
    if (job.superseded) {
      await finish('skipped', 'duplicate_address');
      continue;
    }
    // Or in this one. Checked here rather than in the claim, and after every
    // eligibility test above, because a copy cannot be a duplicate of one that
    // was never sent: the claim used to suppress the eligible sibling on
    // behalf of an ineligible one and the mailbox got nothing (review round 3).
    if (alreadyGone.has(copyKey(job))) {
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
      alreadyGone.add(copyKey(job));
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

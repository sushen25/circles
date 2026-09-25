import {
  type NotificationKind,
  type PlanState,
  QUIET_SENSITIVE_KINDS,
  instant,
  isTerminal,
  notificationSpec,
  organiserEmailStopped,
} from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { EmailSendError, sendEmail } from '../_shared/email/resend.ts';
import { render } from '../_shared/email/render.tsx';
import { log } from '../_shared/logging.ts';
import { type CircleContext, nudgeAtSend } from './cadence.ts';
import { closingHeld } from './closing.ts';
import { inputFor } from './compose.ts';
import { type PlanContext, loadContext } from './context.ts';
import { classify } from './drain.ts';

/**
 * Sending what is due.
 *
 * Seven checks happen here and not one of them could have happened when the job
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
 *     removed by its owner (ADR 0020);
 *   * the **circle** may have been archived, which stops all prompts (spec
 *     §5.2, S1-23);
 *   * the **organiser** may have turned organiser email off since. Did it
 *     happen is written at confirmation and sent the next morning (ADR 0029).
 *
 * And an eighth, for the cadence nudge alone: it may not be owed any more. It
 * can wait overnight for quiet hours, and by morning somebody may have made a
 * plan, the owner snoozed, the person turned nudges off or left, or the circle
 * met. `nudgeHeld` is the domain's answer, from the circle as it is now (S2-04).
 *
 * And a ninth, for the organiser's letters: the plan may have been handed to
 * somebody else, and a `replies_closed` may have stopped being true — locked
 * in, or given one more day (`closingHeld`, S2-05).
 *
 * All nine are `skipped`, not `failed`: nothing went wrong.
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
  /** Whether the plan's circle is archived **now**: archiving stops all prompts (spec §5.2). */
  readonly circle_archived: boolean;
  /** Whether the contact's owner has turned "Emails about plans you organise" off, **now**. */
  readonly organiser_email_muted: boolean;
  /** Whether the contact's owner has muted quiet asks (or everything) in the plan's circle, **now**. */
  readonly quiet_asks_muted?: boolean;
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
  // "Not enough people were free this time" is *about* the ask having expired.
  if (job.kind === 'quiet_expired') return false;
  // `isTerminal` is the domain's, over `TERMINAL_STATES`. Spelling the three
  // states out here is the shape that goes stale the day a fourth is added.
  return job.plan_state !== null && isTerminal(job.plan_state as PlanState);
}

/**
 * The kinds whose whole content belongs to one revision of the question.
 *
 * `options_ready` is a candidate set, and `replies_closed` and
 * `deadline_approaching` are deadlines; each is an answer to the question the
 * plan was asking at the revision the job was stamped with. A `replies_closed`
 * held overnight by quiet hours while the organiser edits the plan would
 * otherwise arrive saying replies are closed on a plan that is asking again,
 * and send them to a screen that no longer applies (review round 4).
 *
 * `deadline_approaching` cannot be reached today — it is push-only and
 * `dispatch_claim_due` claims email — and is listed because the rule is about
 * the kind rather than about which channel happens to carry it (SUS-59). When the plan has moved past it — an edit, a reopen — the
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
const REVISION_SCOPED: readonly string[] = [
  'options_ready',
  'replies_closed',
  'deadline_approaching',
];

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
  if (NEVER_COLLAPSED.includes(job.kind)) return job.id;
  return [job.kind, job.plan_id ?? '', job.plan_revision ?? '', job.email].join('\u0000');
}

/**
 * The kinds that are never two copies of one letter, whatever they share.
 *
 * `changed` and `verify_email` can legitimately occur twice within one
 * revision — a second material change, a second verification request — and are
 * keyed by change id and verification id for exactly that reason. `about_time`
 * belongs to a circle and carries no plan at all, so *every* one of them to an
 * address would match every other and a person would receive one cadence nudge,
 * ever.
 *
 * The same three `dispatch_claim_due` excludes. The two halves of one rule were
 * written twice and had already drifted by one kind when round 4 looked
 * (`about_time` was in the SQL and not here), which is the shape this comment
 * exists to stop: if the list changes, it changes in both places.
 */
const NEVER_COLLAPSED: readonly string[] = [
  'changed',
  'verify_email',
  'about_time',
  // Once per deadline and once more a day later, on one revision (S2-05):
  // collapsed by revision, the second closure is a copy of the first.
  'replies_closed',
];

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
  const circles = new Map<string, CircleContext | null>();
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
    // "Archiving stops all prompts" (spec §5.2), including the ones already
    // queued. `verify_email` is the exception, as it is for suppression's
    // opposite: it answers something the person just asked for, and is not a
    // prompt about the circle.
    if (job.circle_archived && job.kind !== 'verify_email') {
      await finish('skipped', 'circle_archived');
      continue;
    }
    // "Emails about plans you organise", read again now rather than trusted
    // from when the job was written. Which kinds it stops is the domain's.
    if (organiserEmailStopped(job.kind as NotificationKind, job.organiser_email_muted)) {
      await finish('skipped', 'organiser_email_off');
      continue;
    }
    // The initiator's two letters (ADR 0038), read again now: a letter held by
    // quiet hours overnight must not reach somebody who has since muted quiet
    // asks, or left the circle (SUS-50 review round 2).
    if (QUIET_SENSITIVE_KINDS.includes(job.kind as NotificationKind)) {
      if (!job.member_active) {
        await finish('skipped', 'not_a_member');
        continue;
      }
      if (job.quiet_asks_muted === true) {
        await finish('skipped', 'quiet_asks_muted');
        continue;
      }
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

      // Handed over, locked in, or given another day since it was written.
      const held = closingHeld(job, context, instant(Date.now()));
      if (held !== undefined) {
        await finish('skipped', held);
        continue;
      }

      // The cadence nudge: its circle, read now, and whether it is still owed.
      const nudge = await nudgeAtSend(service, job, circles, instant(Date.now()));
      if (nudge.held !== undefined) {
        await finish('skipped', nudge.held);
        continue;
      }
      const circle = nudge.circle;

      const input = await inputFor(service, job, context, circle, instant(Date.now()));
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

import type { Db } from '../_shared/db.ts';
import { optional } from '../_shared/env.ts';
import { EmailSendError, sendEmail } from '../_shared/email/resend.ts';
import { log } from '../_shared/logging.ts';

/**
 * The daily health summary (ticket step 5).
 *
 * Four counts and two timestamps, once a day from 08:00 UTC. Whether the day
 * is still owed is a fact in the database — `public.dispatch_health_due` —
 * because a dispatcher that runs every minute and remembers nothing between
 * runs cannot decide "once a day" for itself. The claim that closes the day is
 * a `health.reported` row in `private.audit_log`, and it is written **after**
 * the letter is out: written first, a provider having a bad morning took the
 * whole day's report with it (review round 3).
 *
 * **It is always logged and only sometimes sent.** `HEALTH_REPORT_TO` is an
 * optional secret; with no address the report is a structured log line, which
 * is where a `dev` project should leave it, and the summary is still recorded
 * in `private.audit_log` either way. S4-06 builds the founder's diagnostics
 * screen on the same function.
 *
 * The words are here rather than in `_shared/email/copy.ts` on purpose. That
 * file is the product's voice, keyed by `NotificationKind`, and every kind in
 * it is checked against the artboards; this is an operator's report addressed
 * to one person who runs the service. It is also the only email in the system
 * that is not a `notification_jobs` row, because it has no recipient in the
 * product's sense — no contact, no member, no plan.
 */

type Summary = Record<string, number | string | null>;

const FIELDS: readonly string[] = [
  'failed_jobs_24h',
  'stuck_outbox',
  'suppressed_24h',
  'stuck_ready_plans',
  'dispatcher_last_finished_at',
  'retention_last_finished_at',
];

function lines(summary: Summary): string {
  return FIELDS.map((field) => `${field}: ${String(summary[field] ?? '—')}`).join('\n');
}

function countsOf(summary: Summary): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const field of FIELDS) {
    const value = summary[field];
    if (typeof value === 'number') counts[field] = value;
  }
  return counts;
}

export async function reportHealth(service: Db, requestId: string): Promise<boolean> {
  const { data: due, error: dueError } = await service.rpc('dispatch_health_due');
  if (dueError !== null) throw dueError;
  if (due !== true) return false;

  const { data, error } = await service.rpc('dispatch_health', { p_claim: false });
  if (error !== null) throw error;
  // `p_claim => false` always answers a row, so null means the function has
  // changed under us. A run that falls over on its own health report is worse
  // than one that skips it.
  if (data === null) return false;
  const summary = data as unknown as Summary;

  const to = optional('HEALTH_REPORT_TO');
  if (to !== undefined) {
    const text = `${lines(summary)}\n`;
    try {
      await sendEmail(
        {
          to,
          subject: 'Daily health summary',
          html: `<pre>${text}</pre>`,
          text,
          tags: { kind: 'health' },
        },
        // There is no contact: this letter is to whoever runs the service, and
        // the address is a secret rather than a row. The sender logs whatever
        // it is given in place of the address, so it is given the name of the
        // report rather than an id that does not exist.
        { contactId: 'health-summary', requestId },
      );
    } catch (thrown) {
      const retryable = thrown instanceof EmailSendError && thrown.retryable;
      log('warn', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: 'health_unsent',
        reason: thrown instanceof EmailSendError ? thrown.code : 'unknown',
      });
      // A provider having a bad morning must not take the day's report with
      // it. The day is left unclaimed, so the next tick tries again — but only
      // for a failure that is worth retrying: a rejected or unconfigured send
      // would otherwise be attempted every minute for fourteen hours.
      if (retryable) return false;
    }
  }

  // Claimed last, and never before the letter is out (review round 3). The
  // claim re-reads the counts, so the audit row holds the numbers as of the
  // moment the day was closed.
  const { error: claimError } = await service.rpc('dispatch_health', { p_claim: true });
  if (claimError !== null) throw claimError;

  // And the line is written here rather than above it, so that "reported"
  // means the report went. Logged before the send, a provider having a bad
  // morning produced sixty lines an hour each claiming a report that never
  // left (review round 4).
  log('info', {
    fn: 'process-scheduled-jobs',
    request_id: requestId,
    event: 'health_reported',
    counts: countsOf(summary),
  });
  return true;
}

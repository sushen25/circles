import type { Db } from '../_shared/db.ts';
import { optional } from '../_shared/env.ts';
import { EmailSendError, sendEmail } from '../_shared/email/resend.ts';
import { log } from '../_shared/logging.ts';

/**
 * The daily health summary (ticket step 5).
 *
 * Four counts and two timestamps, once a day from 08:00 UTC. The claim is
 * made in the database — `public.dispatch_health` writes a `health.reported`
 * row and answers null when today's is already made — because a dispatcher
 * that runs every minute and remembers nothing between runs cannot decide
 * "once a day" for itself.
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
  const { data, error } = await service.rpc('dispatch_health', { p_claim: true });
  if (error !== null) throw error;
  if (data === null) return false;

  const summary = data as unknown as Summary;
  log('info', {
    fn: 'process-scheduled-jobs',
    request_id: requestId,
    event: 'health_reported',
    counts: countsOf(summary),
  });

  const to = optional('HEALTH_REPORT_TO');
  if (to === undefined) return true;

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
      // the address is a secret rather than a row. The sender logs whatever it
      // is given in place of the address, so it is given the name of the
      // report rather than an id that does not exist.
      { contactId: 'health-summary', requestId },
    );
  } catch (thrown) {
    // A health report that cannot be sent must not fail the run that produced
    // it: the numbers it carries are about a system that is otherwise working.
    log('warn', {
      fn: 'process-scheduled-jobs',
      request_id: requestId,
      event: 'health_unsent',
      reason: thrown instanceof EmailSendError ? thrown.code : 'unknown',
    });
  }
  return true;
}

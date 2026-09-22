import { brand } from '@circles/config';

import { optional } from '../env.ts';
import { log } from '../logging.ts';

/**
 * Sending one email, and nothing about which one or why.
 *
 * Two transports, chosen by configuration, and never both:
 *
 * - **Capture**, when `EMAIL_CAPTURE_URL` is set: the message goes to the local
 *   mail catcher's HTTP API (Mailpit, `pnpm mail`). `supabase/config.toml` sets
 *   it for every local stack, and it **wins over `RESEND_API_KEY`**, so a local
 *   or CI stack cannot reach the real provider even if somebody puts a real key
 *   in their shell. No hosted project sets it.
 * - **Resend**, when `RESEND_API_KEY` is set: the REST API, which is one POST
 *   and not worth a dependency (non-negotiable 11).
 *
 * Neither set is `email_unconfigured` — which is what `dev` is on purpose
 * (runbook: "`dev` does not send"), so a dispatcher there fails the job with a
 * code rather than pretending it was sent.
 *
 * **An address never reaches a log, an error or a thrown message.** The
 * provider's error bodies quote the recipient ("Invalid `to` field: …"), so
 * they are never read into anything: an error carries a code and a status and
 * that is all. What is logged is the contact id the caller names.
 */

export type EmailMessage = {
  /** The recipient. The only place in the send path an address exists. */
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** `List-Unsubscribe`, from `render`. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Provider tags: ASCII letters, digits, `_` and `-` only. Never content. */
  readonly tags?: Readonly<Record<string, string>> | undefined;
};

export type SendContext = {
  /** Logged instead of the address. */
  readonly contactId: string;
  /** The request or run this send belongs to. */
  readonly requestId: string;
  /**
   * The notification job's idempotency key (§13). Resend keeps it for 24 hours
   * and answers a repeat with the first send's id instead of a second email,
   * so a dispatcher that crashed after sending and before recording cannot
   * mail somebody twice.
   */
  readonly idempotencyKey?: string | undefined;
};

export type SendResult = {
  /** Resend's `id`, which every webhook event about this message carries. */
  readonly providerMessageId: string;
  readonly transport: 'resend' | 'capture';
};

export type EmailErrorCode =
  /** No transport is configured. Not retryable until somebody configures one. */
  | 'email_unconfigured'
  /** The provider refused the message (400/422). Retrying sends the same refusal. */
  | 'email_rejected'
  /** Our key was refused (401/403). A configuration fault, not the message's. */
  | 'email_unauthorised'
  /** Too many requests (429). Retry later. */
  | 'email_rate_limited'
  /** The provider could not be reached, timed out or failed (408, 5xx, network). Retry later. */
  | 'email_unavailable';

const RETRYABLE: ReadonlySet<EmailErrorCode> = new Set(['email_rate_limited', 'email_unavailable']);

export class EmailSendError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: EmailErrorCode,
    /** The provider's HTTP status, when there was one. Never its body. */
    readonly status?: number | undefined,
  ) {
    super(code);
    this.name = 'EmailSendError';
    this.retryable = RETRYABLE.has(code);
  }
}

type Fetch = typeof fetch;

/**
 * How long one send may take before it is a failure.
 *
 * `fetch` has no timeout of its own, and the one caller that matters is a
 * dispatcher run working to a fifty-second budget: a provider that accepts the
 * connection and never answers would carry the run past it, and past the
 * ninety-second lease that covers the overrun. Twenty seconds is far longer
 * than any send this has ever made, and short enough that the send phase can
 * keep that much budget in reserve for the last one it starts.
 */
const SEND_TIMEOUT_MS = 20_000;

/** Resend's own rule for tag names and values, which also keeps content out of them. */
const TAG = /^[A-Za-z0-9_-]{1,256}$/;

/** `Name <hello@…>` → its two halves, for a transport that wants them apart. */
function sender(): { name: string; email: string } {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(brand.sender);
  return match === null
    ? { name: brand.name, email: brand.sender }
    : { name: match[1] ?? brand.name, email: match[2] ?? brand.sender };
}

function codeFor(status: number): EmailErrorCode {
  if (status === 401 || status === 403) return 'email_unauthorised';
  if (status === 429) return 'email_rate_limited';
  // A timeout says nothing about the message; the same send may well work.
  if (status === 408 || status >= 500) return 'email_unavailable';
  return 'email_rejected';
}

async function idOf(response: Response, field: 'id' | 'ID'): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new EmailSendError('email_unavailable', response.status);
  }
  const id = (body as Record<string, unknown> | null)?.[field];
  if (typeof id !== 'string' || id === '') throw new EmailSendError('email_unavailable');
  return id;
}

async function viaResend(
  key: string,
  message: EmailMessage,
  context: SendContext,
  http: Fetch,
): Promise<string> {
  const response = await http('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(context.idempotencyKey === undefined
        ? {}
        : { 'idempotency-key': context.idempotencyKey }),
    },
    body: JSON.stringify({
      from: brand.sender,
      to: [message.to],
      reply_to: brand.supportEmail,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers ?? {},
      tags: Object.entries(message.tags ?? {}).map(([name, value]) => ({ name, value })),
    }),
  });
  if (!response.ok) {
    // The body is not read: it can quote the address we sent to.
    await response.body?.cancel();
    throw new EmailSendError(codeFor(response.status), response.status);
  }
  return idOf(response, 'id');
}

async function viaCapture(base: string, message: EmailMessage, http: Fetch): Promise<string> {
  const from = sender();
  const response = await http(`${base.replace(/\/+$/, '')}/api/v1/send`, {
    method: 'POST',
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      From: { Email: from.email, Name: from.name },
      To: [{ Email: message.to }],
      ReplyTo: [{ Email: brand.supportEmail }],
      Subject: message.subject,
      HTML: message.html,
      Text: message.text,
      Headers: message.headers ?? {},
      Tags: Object.entries(message.tags ?? {}).map(([name, value]) => `${name}:${value}`),
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new EmailSendError(codeFor(response.status), response.status);
  }
  return idOf(response, 'ID');
}

export async function sendEmail(
  message: EmailMessage,
  context: SendContext,
  http: Fetch = fetch,
): Promise<SendResult> {
  const capture = optional('EMAIL_CAPTURE_URL');
  const key = optional('RESEND_API_KEY');
  const transport = capture !== undefined ? 'capture' : key !== undefined ? 'resend' : undefined;
  const started = Date.now();

  const record = (event: 'sent' | 'send_failed', reason?: string, status?: number) =>
    log(event === 'sent' ? 'info' : 'warn', {
      fn: 'email',
      request_id: context.requestId,
      event,
      reason,
      status,
      contact_id: context.contactId,
      duration_ms: Date.now() - started,
    });

  try {
    if (transport === undefined) throw new EmailSendError('email_unconfigured');
    for (const [name, value] of Object.entries(message.tags ?? {})) {
      if (!TAG.test(name) || !TAG.test(value)) throw new EmailSendError('email_rejected');
    }
    const providerMessageId =
      transport === 'capture'
        ? await viaCapture(capture as string, message, http)
        : await viaResend(key as string, message, context, http);
    record('sent');
    return { providerMessageId, transport };
  } catch (thrown) {
    // A network failure from `fetch` is a TypeError whose message can name the
    // host, and a timeout is a `TimeoutError` — neither is ours to pass on, and
    // both are `email_unavailable`, which is retryable, which is right: the
    // same send may well work in a minute.
    const failure =
      thrown instanceof EmailSendError ? thrown : new EmailSendError('email_unavailable');
    record('send_failed', failure.code, failure.status);
    throw failure;
  }
}

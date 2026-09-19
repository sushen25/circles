import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailSendError, sendEmail } from './resend.ts';

/**
 * The provider is a `fetch` handed in, so nothing here reaches the network —
 * and the one assertion that matters most is that a local stack, which sets
 * `EMAIL_CAPTURE_URL`, cannot reach Resend even with a key in its environment.
 */

const ADDRESS = 'priya@example.com';
const MESSAGE = {
  to: ADDRESS,
  subject: 'Locked in: Sunday Crew, Thu 17 Sep',
  html: '<p>Hi</p>',
  text: 'Hi',
  headers: { 'List-Unsubscribe': '<https://meet.example.com/e#x>' },
  tags: { kind: 'locked_in' },
};
const CONTEXT = { contactId: 'contact-1', requestId: 'request-1', idempotencyKey: 'a'.repeat(64) };

type Call = { url: string; init: RequestInit };

function provider(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { http, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let lines: string[];

beforeEach(() => {
  delete process.env['EMAIL_CAPTURE_URL'];
  delete process.env['RESEND_API_KEY'];
  lines = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['EMAIL_CAPTURE_URL'];
  delete process.env['RESEND_API_KEY'];
});

/** Built at run time: a fixed key-shaped literal is what a secret scanner looks for. */
const fakeKey = () => `re_${crypto.randomUUID().replace(/-/g, '')}`;

describe('sendEmail', () => {
  it('refuses with email_unconfigured when there is nowhere to send, and calls nothing', async () => {
    const { http, calls } = provider(() => json(200, { id: 'x' }));
    const failure = await sendEmail(MESSAGE, CONTEXT, http).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmailSendError);
    expect((failure as EmailSendError).code).toBe('email_unconfigured');
    expect((failure as EmailSendError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('sends to the capture inbox, and never to Resend, when a local stack has both', async () => {
    process.env['EMAIL_CAPTURE_URL'] = 'http://inbucket:8025/';
    process.env['RESEND_API_KEY'] = fakeKey();
    const { http, calls } = provider(() => json(200, { ID: 'captured-1' }));

    const sent = await sendEmail(MESSAGE, CONTEXT, http);

    expect(sent).toEqual({ providerMessageId: 'captured-1', transport: 'capture' });
    expect(calls.map((call) => call.url)).toEqual(['http://inbucket:8025/api/v1/send']);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.To).toEqual([{ Email: ADDRESS }]);
    expect(body.Headers).toEqual(MESSAGE.headers);
    expect(body.Text).toBe('Hi');
  });

  it('posts to Resend with the key, the idempotency key and the unsubscribe header', async () => {
    const key = fakeKey();
    process.env['RESEND_API_KEY'] = key;
    const { http, calls } = provider(() => json(200, { id: 'resend-1' }));

    const sent = await sendEmail(MESSAGE, CONTEXT, http);

    expect(sent).toEqual({ providerMessageId: 'resend-1', transport: 'resend' });
    const [call] = calls;
    expect(call?.url).toBe('https://api.resend.com/emails');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${key}`);
    expect(headers['idempotency-key']).toBe(CONTEXT.idempotencyKey);
    const body = JSON.parse(String(call?.init.body));
    expect(body).toMatchObject({
      to: [ADDRESS],
      subject: MESSAGE.subject,
      html: MESSAGE.html,
      text: MESSAGE.text,
      headers: MESSAGE.headers,
      tags: [{ name: 'kind', value: 'locked_in' }],
    });
    expect(body.from).toMatch(/<[^>]+@mail\./);
  });

  it.each([
    [422, 'email_rejected', false],
    [400, 'email_rejected', false],
    [401, 'email_unauthorised', false],
    [408, 'email_unavailable', true],
    [429, 'email_rate_limited', true],
    [503, 'email_unavailable', true],
  ] as const)('maps a %i to %s (retryable: %s)', async (status, code, retryable) => {
    process.env['RESEND_API_KEY'] = fakeKey();
    const { http } = provider(() =>
      json(status, { message: `Invalid \`to\` field: ${ADDRESS}`, name: 'validation_error' }),
    );

    const failure = (await sendEmail(MESSAGE, CONTEXT, http).catch(
      (e: unknown) => e,
    )) as EmailSendError;

    expect(failure).toBeInstanceOf(EmailSendError);
    expect(failure.code).toBe(code);
    expect(failure.status).toBe(status);
    expect(failure.retryable).toBe(retryable);
    // The provider's body quoted the address. None of it came through.
    expect(JSON.stringify({ ...failure, message: failure.message })).not.toContain(ADDRESS);
  });

  it('turns a network failure into email_unavailable without passing its message on', async () => {
    process.env['RESEND_API_KEY'] = fakeKey();
    const { http } = provider(() => {
      throw new TypeError(`fetch failed for ${ADDRESS}`);
    });
    const failure = (await sendEmail(MESSAGE, CONTEXT, http).catch(
      (e: unknown) => e,
    )) as EmailSendError;
    expect(failure.code).toBe('email_unavailable');
    expect(failure.message).not.toContain(ADDRESS);
  });

  it('refuses a tag that could carry content, before calling anybody', async () => {
    process.env['RESEND_API_KEY'] = fakeKey();
    const { http, calls } = provider(() => json(200, { id: 'x' }));
    const failure = (await sendEmail(
      { ...MESSAGE, tags: { circle: 'Sunday Crew' } },
      CONTEXT,
      http,
    ).catch((e: unknown) => e)) as EmailSendError;
    expect(failure.code).toBe('email_rejected');
    expect(calls).toHaveLength(0);
  });

  it('logs the contact id and never the address, sent or not', async () => {
    process.env['RESEND_API_KEY'] = fakeKey();
    await sendEmail(MESSAGE, CONTEXT, provider(() => json(200, { id: 'ok' })).http);
    await sendEmail(MESSAGE, CONTEXT, provider(() => json(422, { message: ADDRESS })).http).catch(
      () => undefined,
    );

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain(ADDRESS);
      expect(line).not.toContain(MESSAGE.subject);
      expect(JSON.parse(line)).toMatchObject({ fn: 'email', contact_id: 'contact-1' });
    }
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({
      event: 'send_failed',
      reason: 'email_rejected',
    });
  });
});

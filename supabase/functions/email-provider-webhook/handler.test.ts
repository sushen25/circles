import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '../_shared/db.ts';
import { sha256Hex } from '../_shared/hash.ts';
import { emailProviderWebhook } from './handler.ts';

/**
 * The webhook, driven with requests signed the way the provider signs them.
 *
 * The signing here is written out again from the Svix description rather than
 * borrowed from `svix.ts`, so a mistake there — the wrong bytes signed, the
 * prefix left on the key — is not one the test shares. And the secret is made
 * at run time: a `whsec_…` literal in the repository is what the secret
 * scanner fails CI for, and rightly.
 */

const ADDRESS = 'priya@example.com';
const PLAN = '00000000-0000-4000-8000-0000000000aa';
const CIRCLE = '00000000-0000-4000-8000-0000000000bb';
const CONTACT = '00000000-0000-4000-8000-0000000000cc';
const NOW = 1_790_000_000;

let secret: string;
let calls: { fn: string; args: Record<string, unknown> }[];
let answers: Record<string, { data: unknown; error: unknown }>;
let lines: string[];

const service = {
  rpc: (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return Promise.resolve(answers[fn] ?? { data: null, error: null });
  },
} as unknown as Db;

const webhook = () =>
  emailProviderWebhook({ secret: () => secret, service: () => service, now: () => NOW });

/** Random bytes as base64 — a signing key, made fresh for each test. */
function randomKey(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
}

async function sign(
  body: string,
  options: { id?: string | undefined; timestamp?: number; key?: string } = {},
): Promise<Record<string, string>> {
  const id = options.id ?? `msg_${crypto.randomUUID()}`;
  const timestamp = String(options.timestamp ?? NOW);
  const raw = Uint8Array.from(atob((options.key ?? secret).slice('whsec_'.length)), (c) =>
    c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` };
}

function post(body: string, headers: Record<string, string>) {
  return new Request('http://localhost/functions/v1/email-provider-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

function event(type: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type,
    created_at: '2026-09-17T09:00:00.000Z',
    data: {
      email_id: 'resend-message-1',
      created_at: '2026-09-17T08:59:59.000Z',
      from: 'Sender <hello@mail.example.com>',
      to: [ADDRESS],
      subject: 'Locked in: Sunday Crew, Thu 17 Sep',
      ...extra,
    },
  });
}

const recorded = (overrides: Record<string, unknown> = {}) => ({
  data: {
    recorded: true,
    suppressed: false,
    contact_id: CONTACT,
    plan_id: PLAN,
    circle_id: CIRCLE,
    ...overrides,
  },
  error: null,
});

beforeEach(() => {
  secret = `whsec_${randomKey()}`;
  calls = [];
  answers = { record_email_delivery: recorded(), record_events: { data: 1, error: null } };
  lines = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  }
});

afterEach(() => vi.restoreAllMocks());

describe('email-provider-webhook', () => {
  describe('refuses anything the provider did not sign, and touches nothing', () => {
    it('with no secret configured: fails closed', async () => {
      const body = event('email.complained');
      const headers = await sign(body);
      const response = await emailProviderWebhook({
        secret: () => undefined,
        service: () => service,
        now: () => NOW,
      })(post(body, headers));
      expect(response.status).toBe(401);
      expect(calls).toEqual([]);
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ reason: 'unconfigured' });
    });

    it('with a signature made with another secret', async () => {
      const body = event('email.complained');
      const forged = await sign(body, { key: `whsec_${randomKey()}` });
      expect((await webhook()(post(body, forged))).status).toBe(401);
      expect(calls).toEqual([]);
    });

    it('with a body changed after it was signed', async () => {
      const headers = await sign(event('email.delivered'));
      expect((await webhook()(post(event('email.complained'), headers))).status).toBe(401);
      expect(calls).toEqual([]);
    });

    it('with no signature headers at all', async () => {
      expect((await webhook()(post(event('email.complained'), {}))).status).toBe(401);
      expect(calls).toEqual([]);
    });

    it('with a signature older than five minutes, which is a replay from the past', async () => {
      const body = event('email.complained');
      const old = await sign(body, { timestamp: NOW - 6 * 60 });
      const response = await webhook()(post(body, old));
      expect(response.status).toBe(401);
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ reason: 'stale' });
      expect(calls).toEqual([]);
    });

    it('with a GET', async () => {
      const response = await webhook()(
        new Request('http://localhost/functions/v1/email-provider-webhook'),
      );
      expect(response.status).toBe(405);
    });
  });

  it('accepts any one of several signatures, as during a secret rotation', async () => {
    const body = event('email.delivered');
    const headers = await sign(body);
    const stale = await sign(body, { id: headers['svix-id'], key: `whsec_${randomKey()}` });
    const both = {
      ...headers,
      'svix-signature': `${stale['svix-signature']} ${headers['svix-signature']}`,
    };
    expect((await webhook()(post(body, both))).status).toBe(200);
  });

  it('records a complaint against the hash of the address, and never the address', async () => {
    answers['record_email_delivery'] = recorded({ suppressed: true });
    const body = event('email.complained');

    const response = await webhook()(post(body, await sign(body)));

    expect(response.status).toBe(200);
    const [store, track] = calls;
    expect(store?.fn).toBe('record_email_delivery');
    expect(store?.args).toEqual({
      p_provider_message_id: 'resend-message-1',
      p_event_type: 'complained',
      p_occurred_at: '2026-09-17T09:00:00.000Z',
      p_permanent: true,
      p_email_hash: await sha256Hex(ADDRESS),
    });
    expect(track?.fn).toBe('record_events');
    const [row] = (track?.args['p_rows'] as Record<string, unknown>[]) ?? [];
    expect(row).toMatchObject({
      event_name: 'email_delivery_result',
      properties: { code: 'complained' },
      plan_id: PLAN,
      circle_id: CIRCLE,
      user_id: null,
    });

    const logged = lines.join('\n');
    expect(logged).not.toContain(ADDRESS);
    expect(logged).not.toContain('Sunday Crew');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'suppressed',
      reason: 'complained',
      contact_id: CONTACT,
    });
  });

  it('normalises the address as the contact table does before hashing it', async () => {
    const body = event('email.bounced', { to: ['Priya <  PRIYA@example.com >'] });
    await webhook()(post(body, await sign(body)));
    expect(calls[0]?.args['p_email_hash']).toBe(await sha256Hex(ADDRESS));
  });

  it('marks a transient bounce as not permanent, so it suppresses nothing', async () => {
    const body = event('email.bounced', { bounce: { type: 'Transient', message: 'mailbox full' } });
    await webhook()(post(body, await sign(body)));
    expect(calls[0]?.args).toMatchObject({ p_event_type: 'bounced', p_permanent: false });
  });

  it('treats a bounce it cannot classify as hard', async () => {
    const body = event('email.bounced', { bounce: { type: 'Undetermined' } });
    await webhook()(post(body, await sign(body)));
    expect(calls[0]?.args).toMatchObject({ p_permanent: true });
  });

  it('stores delivery_delayed as deferred', async () => {
    const body = event('email.delivery_delayed');
    await webhook()(post(body, await sign(body)));
    expect(calls[0]?.args['p_event_type']).toBe('deferred');
  });

  it('answers a replay 200 and writes the same analytics row, so nothing counts twice', async () => {
    const body = event('email.delivered');
    const headers = await sign(body);
    await webhook()(post(body, headers));
    answers['record_email_delivery'] = recorded({ recorded: false });
    const again = await webhook()(post(body, headers));

    expect(again.status).toBe(200);
    const ids = calls
      .filter((call) => call.fn === 'record_events')
      .map((call) => (call.args['p_rows'] as { event_id: string }[])[0]?.event_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ event: 'replayed' });
  });

  it('acknowledges an event it does not record, without storing anything', async () => {
    for (const type of ['email.opened', 'email.clicked', 'contact.created']) {
      const body = event(type);
      expect((await webhook()(post(body, await sign(body)))).status).toBe(200);
    }
    const unreadable = 'not json';
    expect((await webhook()(post(unreadable, await sign(unreadable)))).status).toBe(200);
    expect(calls).toEqual([]);
  });

  it('answers 500 when the store fails, so the provider retries, and logs no database message', async () => {
    answers['record_email_delivery'] = {
      data: null,
      error: { message: `duplicate key for ${ADDRESS}`, code: '23505' },
    };
    const body = event('email.complained');
    const response = await webhook()(post(body, await sign(body)));
    expect(response.status).toBe(500);
    expect(lines.join('\n')).not.toContain(ADDRESS);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'failed',
      reason: 'record_email_delivery_failed',
    });
  });
});

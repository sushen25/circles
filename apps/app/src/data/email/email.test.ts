import { CONSENT } from '@circles/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeFunction = vi.fn();
vi.mock('../functions', () => ({
  invokeFunction: (...args: unknown[]) => invokeFunction(...args),
}));

const { rememberTypedAddress, requestEmailUpdates, typedAddress } = await import('./index');

describe('the typed address (round 1)', () => {
  it('is only ever shown to the person who typed it, not the next one on the same tab', () => {
    rememberTypedAddress('priya', 'plan-1', 'priya@example.com');

    expect(typedAddress('priya', 'plan-1')).toBe('priya@example.com');
    expect(typedAddress('tom', 'plan-1')).toBeUndefined();
  });
});

describe('requestEmailUpdates', () => {
  beforeEach(() => {
    invokeFunction.mockReset().mockResolvedValue({ status: 'check_email' });
  });

  it('sends the consent version this build rendered, alongside the address (ADR 0048)', async () => {
    await requestEmailUpdates({
      planId: 'plan-1',
      email: 'priya@example.com',
      idempotencyKey: 'key-1' as never,
    });

    const [name, body] = invokeFunction.mock.calls[0] ?? [];
    expect(name).toBe('request-email-updates');
    expect(body).toMatchObject({ email: 'priya@example.com', consent_version: CONSENT.version });
  });
});

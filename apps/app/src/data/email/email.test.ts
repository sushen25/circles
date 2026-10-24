import { CONSENT, CONSENT_NO_ACCOUNT } from '@circles/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeFunction = vi.fn();
vi.mock('../functions', () => ({
  invokeFunction: (...args: unknown[]) => invokeFunction(...args),
}));

const { rememberTypedAddress, requestEmailUpdates, typedAccount, typedAddress } =
  await import('./index');

describe('the typed address (round 1)', () => {
  it('is only ever shown to the person who typed it, not the next one on the same tab', () => {
    rememberTypedAddress('nina', 'plan-1', 'nina@example.com', false);

    expect(typedAddress('nina', 'plan-1')).toBe('nina@example.com');
    expect(typedAddress('tom', 'plan-1')).toBeUndefined();
  });

  it('remembers which sentence the card showed with it, for a resend', () => {
    rememberTypedAddress('nina', 'plan-1', 'nina@example.com', true);
    expect(typedAccount('nina', 'plan-1')).toBe(true);
    rememberTypedAddress('nina', 'plan-1', 'nina@example.com', false);
    expect(typedAccount('nina', 'plan-1')).toBe(false);
    expect(typedAccount('tom', 'plan-1')).toBe(false);
  });
});

describe('requestEmailUpdates', () => {
  beforeEach(() => {
    invokeFunction.mockReset().mockResolvedValue({ status: 'check_email' });
  });

  it('sends the version of the sentence the card showed, alongside the address (ADR 0048)', async () => {
    await requestEmailUpdates({
      planId: 'plan-1',
      email: 'nina@example.com',
      idempotencyKey: 'key-1' as never,
      account: true,
    });
    await requestEmailUpdates({
      planId: 'plan-1',
      email: 'nina@example.com',
      idempotencyKey: 'key-2' as never,
      account: false,
    });

    const [name, withAccount] = invokeFunction.mock.calls[0] ?? [];
    const [, withoutAccount] = invokeFunction.mock.calls[1] ?? [];
    expect(name).toBe('request-email-updates');
    expect(withAccount).toMatchObject({
      email: 'nina@example.com',
      consent_version: CONSENT.version,
    });
    expect(withoutAccount).toMatchObject({ consent_version: CONSENT_NO_ACCOUNT.version });
    expect(CONSENT.version).not.toBe(CONSENT_NO_ACCOUNT.version);
  });
});

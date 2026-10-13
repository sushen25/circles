import { describe, expect, it } from 'vitest';

import { CALENDAR_TOKEN_SECONDS, checkCalendarToken, signCalendarToken } from './calendarToken.ts';

const KEY = 'a-key-for-the-tests';
const A = '00000000-0000-4000-8000-0000000000f1';
const B = '00000000-0000-4000-8000-0000000000f2';
const NOW = Date.UTC(2099, 8, 16, 12, 0, 0);

describe('the calendar link token (ADR 0063)', () => {
  it('lives for fifteen minutes and is good for the confirmation it was made for', async () => {
    const { token, expiresAt } = await signCalendarToken(KEY, A, NOW);
    expect(CALENDAR_TOKEN_SECONDS).toBe(900);
    expect(expiresAt.getTime() - NOW).toBe(15 * 60 * 1000);
    expect(token).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
    expect(await checkCalendarToken(KEY, token, A, NOW)).toBe('ok');
    expect(await checkCalendarToken(KEY, token, A, NOW + 899_000)).toBe('ok');
  });

  it('is refused at and after its expiry', async () => {
    const { token } = await signCalendarToken(KEY, A, NOW);
    expect(await checkCalendarToken(KEY, token, A, NOW + 900_000)).toBe('expired');
    expect(await checkCalendarToken(KEY, token, A, NOW + 86_400_000)).toBe('expired');
  });

  it('is refused for another confirmation', async () => {
    const { token } = await signCalendarToken(KEY, A, NOW);
    expect(await checkCalendarToken(KEY, token, B, NOW)).toBe('invalid');
  });

  it('is refused under another key', async () => {
    const { token } = await signCalendarToken(KEY, A, NOW);
    expect(await checkCalendarToken('another-key', token, A, NOW)).toBe('invalid');
  });

  it('is refused when the expiry or the signature is changed by a single character', async () => {
    const { token } = await signCalendarToken(KEY, A, NOW);
    const [exp = '', mac = ''] = token.split('.');
    // A later expiry on the same signature: the MAC covers it.
    expect(await checkCalendarToken(KEY, `${Number(exp) + 3600}.${mac}`, A, NOW)).toBe('invalid');
    const flipped = `${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    expect(await checkCalendarToken(KEY, `${exp}.${flipped}`, A, NOW)).toBe('invalid');
  });

  it('is refused when it is not a token at all', async () => {
    for (const junk of [
      '',
      'x',
      '1.2',
      `${'9'.repeat(20)}.${'A'.repeat(43)}`,
      `1.${'A'.repeat(42)}`,
    ]) {
      expect(await checkCalendarToken(KEY, junk, A, NOW)).toBe('invalid');
    }
  });

  it('does not make the same token for two confirmations', async () => {
    const a = await signCalendarToken(KEY, A, NOW);
    const b = await signCalendarToken(KEY, B, NOW);
    expect(a.token).not.toBe(b.token);
  });
});

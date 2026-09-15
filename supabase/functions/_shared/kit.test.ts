import { describe, expect, it } from 'vitest';

import { ProblemReason } from '@circles/contracts';

import { bearerOf } from './auth.ts';
import { ALLOWED_REQUEST_HEADERS } from './respond.ts';
import { required } from './env.ts';
import { sha256Hex } from './hash.ts';
import { stableJson } from './idempotency.ts';
import { plainProblem, problemFor, reasonOf } from './problem.ts';
import { callerAddress } from './rate.ts';
import { isWeb } from './turnstile.ts';

describe('reasonOf', () => {
  it('recognises a name the database raised', () => {
    expect(reasonOf({ message: 'duplicate_name' })).toBe('duplicate_name');
    expect(reasonOf({ message: '  invite_inactive  ' })).toBe('invite_inactive');
  });

  it('does not recognise a reason merely mentioned in a longer message', () => {
    // The trap this guards: `message.includes(reason)` would turn Postgres's own
    // prose into a product error code, and an exception's text is not an
    // interface. Matching the whole message is what keeps the two apart.
    expect(reasonOf({ message: 'relation for duplicate_name does not exist' })).toBeUndefined();
    expect(reasonOf({ message: 'duplicate_name_check failed' })).toBeUndefined();
  });

  it('has nothing to say about an error with no message', () => {
    expect(reasonOf(undefined)).toBeUndefined();
    expect(reasonOf(null)).toBeUndefined();
    expect(reasonOf({})).toBeUndefined();
  });
});

describe('problemFor', () => {
  it('maps every reason the contract declares', () => {
    // The assertion that matters: a reason added to `ProblemReason` and not to
    // the table would otherwise surface as an undefined status at runtime, on
    // the one request that hit it.
    for (const reason of ProblemReason.options) {
      const { status, body } = problemFor(reason, 'because', 'ref-1');
      expect(status, reason).toBeGreaterThanOrEqual(400);
      expect(body.reason, reason).toBe(reason);
      expect(body.reference).toBe('ref-1');
    }
  });

  it('refuses a rotated link and an unknown one identically', () => {
    // Telling them apart would confirm that a circle is there, to somebody
    // holding a secret that is not.
    const rotated = problemFor('invite_inactive', 'That link is no longer active.', 'r');
    expect(rotated.status).toBe(404);
    expect(rotated.body.error).toBe('not_found');
  });

  it('calls a limit rate_limited rather than forbidden', () => {
    expect(problemFor('reattach_limit', 'slow down', 'r').status).toBe(429);
    expect(problemFor('too_many_requests', 'slow down', 'r').body.error).toBe('rate_limited');
  });

  it('leaves the reason out when there is not one worth giving', () => {
    const problem = plainProblem('unauthorised', 401, 'Sign in and try again.', 'r');
    expect(problem.body).not.toHaveProperty('reason');
  });
});

describe('bearerOf', () => {
  it('reads a bearer token however it is capitalised', () => {
    expect(bearerOf('Bearer abc.def')).toBe('abc.def');
    expect(bearerOf('bearer abc.def')).toBe('abc.def');
    expect(bearerOf('BEARER  abc.def')).toBe('abc.def');
    expect(bearerOf('  Bearer abc.def  ')).toBe('abc.def');
  });

  it('finds nothing in a header that is not one', () => {
    expect(bearerOf(null)).toBeUndefined();
    expect(bearerOf('')).toBeUndefined();
    expect(bearerOf('Basic abc')).toBeUndefined();
    expect(bearerOf('Bearer')).toBeUndefined();
    expect(bearerOf('Bearer a b')).toBeUndefined();
  });
});

describe('stableJson', () => {
  it('does not care what order the keys arrived in', () => {
    // Two encodings of one request must fingerprint the same, or a retry that
    // serialised its body differently looks like a different request and the
    // idempotency key reports a mismatch it should not.
    expect(stableJson({ a: 1, b: 2 })).toBe(stableJson({ b: 2, a: 1 }));
    expect(stableJson({ a: { x: 1, y: 2 } })).toBe(stableJson({ a: { y: 2, x: 1 } }));
  });

  it('does care what order an array arrived in', () => {
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
  });

  it('treats an absent field and an undefined one as the same request', () => {
    expect(stableJson({ a: 1, b: undefined })).toBe(stableJson({ a: 1 }));
  });

  it('distinguishes requests that differ', () => {
    expect(stableJson({ name: 'Priya' })).not.toBe(stableJson({ name: 'priya' }));
    expect(stableJson({ a: '1' })).not.toBe(stableJson({ a: 1 }));
  });
});

describe('sha256Hex', () => {
  it('produces the form Postgres reads as a bytea', async () => {
    const digest = await sha256Hex('abc');
    expect(digest).toMatch(/^\\x[0-9a-f]{64}$/);
    // The well-known SHA-256 of "abc".
    expect(digest).toBe('\\xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is the same digest the database computes', async () => {
    // The one place the two implementations have to agree, and the one failure
    // neither side's tests would notice on its own: `090_identity_continuity.sql`
    // stores `extensions.digest('live-secret', 'sha256')` and this is what the
    // function sends to look it up. If they diverged, every redemption would
    // simply fail to find a live invite — and both suites would still pass.
    //
    // The literal came from the database:
    //   select encode(extensions.digest('live-secret', 'sha256'), 'hex');
    expect(await sha256Hex('live-secret')).toBe(
      '\\xd9864c9df61d74b6d8de71d53ac1d88b31d675bd8cf50873c7fffa1c3f684f62',
    );
  });
});

describe('callerAddress', () => {
  it('takes the address the proxy added, not the one the caller wrote', () => {
    // `x-forwarded-for` is a list a client can *start*: whatever it sends
    // arrives first, with the observed address appended after it. Counting the
    // first entry counted a value the caller chose, so a per-address limit
    // could be stepped around by varying a header.
    const request = new Request('https://example.test', {
      headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' },
    });
    expect(callerAddress(request)).toBe('70.41.3.18');
  });

  it('prefers the header a client cannot write at all', () => {
    const request = new Request('https://example.test', {
      headers: { 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '203.0.113.7' },
    });
    expect(callerAddress(request)).toBe('198.51.100.9');
  });

  it('has a constant to count against when there is no header', () => {
    // Not a throw and not a random value: a missing address must still be
    // counted, or a caller who can strip the header has no limit at all.
    expect(callerAddress(new Request('https://example.test'))).toBe('unknown');
  });
});

describe('isWeb', () => {
  it('assumes web when the client says nothing', () => {
    // The safe default: web is the platform Turnstile applies to, so an absent
    // header means the check runs rather than being skipped.
    expect(isWeb(new Request('https://example.test'))).toBe(true);
  });

  it('believes a native client, which is a known and accepted limit', () => {
    const native = new Request('https://example.test', {
      headers: { 'x-circles-platform': 'ios' },
    });
    expect(isWeb(native)).toBe(false);
  });
});

describe('required', () => {
  it('names the variable it could not find', () => {
    // The failure mode this replaces is a module-level `!` that turns a missing
    // secret into a function that will not boot, with the reason in a deploy log.
    expect(() => required('CIRCLES_NO_SUCH_SETTING')).toThrow(/CIRCLES_NO_SUCH_SETTING/);
  });
});

describe('the CORS preflight', () => {
  // A browser asks permission for every header it is about to send, and one
  // missing name fails the whole request before the function runs. These
  // endpoints are web-first, so this is the one list whose omission breaks the
  // product while every server-side test passes.
  it.each([
    // `supabase-js` sends the publishable key in `apikey`, not in Authorization.
    'apikey',
    'authorization',
    'content-type',
    // Its own version, on every request the SDK makes.
    'x-client-info',
    // Sent by newer releases of the SDK.
    'x-supabase-api-version',
    // Ours: the reference a person reads back, and the platform Turnstile turns on.
    'x-request-id',
    'x-circles-platform',
  ])('allows %s', (header) => {
    expect(ALLOWED_REQUEST_HEADERS.split(', ')).toContain(header);
  });
});

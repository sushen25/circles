import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, originOfUrl, securityHeaders } from './securityHeaders.js';

const hash = 'sha256-abc=';

function directive(policy: string, name: string): string[] {
  const found = policy.split('; ').find((d) => d.startsWith(`${name} `));
  return found === undefined ? [] : found.split(' ').slice(1);
}

describe('contentSecurityPolicy', () => {
  const policy = contentSecurityPolicy({
    hydrateScriptHash: hash,
    supabaseUrl: 'https://abcdefgh.supabase.co/',
  });

  it('allows scripts from this origin, the router hash and Turnstile, and nothing else', () => {
    expect(directive(policy, 'script-src')).toEqual([
      "'self'",
      `'${hash}'`,
      'https://challenges.cloudflare.com',
    ]);
    expect(policy).not.toMatch(/unsafe-eval/);
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('lets the page talk to its own Supabase project, by origin', () => {
    expect(directive(policy, 'connect-src')).toContain('https://abcdefgh.supabase.co');
  });

  it('cannot be framed, and cannot be given a new base or form target', () => {
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(policy, 'base-uri')).toEqual(["'self'"]);
    expect(directive(policy, 'form-action')).toEqual(["'self'"]);
    expect(directive(policy, 'object-src')).toEqual(["'none'"]);
  });

  it('names no backend when the build has none', () => {
    const bare = contentSecurityPolicy({ hydrateScriptHash: hash, supabaseUrl: undefined });
    expect(directive(bare, 'connect-src')).not.toContain('undefined');
    expect(bare).not.toMatch(/supabase/);
  });
});

describe('originOfUrl', () => {
  it('keeps the origin and drops the rest', () => {
    expect(originOfUrl('http://127.0.0.1:54321/rest/v1')).toBe('http://127.0.0.1:54321');
  });
  it('reads nothing from nothing', () => {
    expect(originOfUrl(undefined)).toBeUndefined();
    expect(originOfUrl('')).toBeUndefined();
    expect(originOfUrl('not a url')).toBeUndefined();
  });
});

describe('securityHeaders', () => {
  it('is the three headers the ticket names', () => {
    const headers = securityHeaders({ hydrateScriptHash: hash, supabaseUrl: undefined });
    expect(Object.keys(headers).sort()).toEqual([
      'Content-Security-Policy',
      'Permissions-Policy',
      'X-Content-Type-Options',
    ]);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
  });
});

#!/usr/bin/env node
/**
 * Checks a *deployed* environment from the outside: does the domain serve the
 * app over HTTPS with HSTS and the security headers (a Content-Security-Policy,
 * nosniff, a Permissions-Policy), and is the sending subdomain authenticated
 * for email (architecture §5.2, §14)?
 *
 * Run by hand after the vendor setup in docs/runbooks/environment-setup.md.
 * Not part of `pnpm check`: it needs the network and a domain that exists.
 *
 *   pnpm check:env meet.example.com
 *   pnpm check:env dev.example.com --no-email
 *
 * `--no-email` is for an environment that does not send: only production has a
 * sending domain today, and failing `dev` on records it was never meant to have
 * is how a check gets ignored.
 *
 * Reads nothing secret and sends nothing anywhere except DNS and two GETs to the
 * domain itself (`/start`, the app, and `/`, the website).
 */

import { Resolver } from 'node:dns/promises';

const args = process.argv.slice(2);
const skipEmail = args.includes('--no-email');
const domain = args.find((a) => !a.startsWith('--')) ?? process.env.APP_DOMAIN;
if (!domain) {
  console.error('usage: pnpm check:env <domain> [--no-email]');
  console.error('   e.g. pnpm check:env meet.example.com');
  console.error('        pnpm check:env dev.example.com --no-email');
  process.exit(2);
}
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
  console.error(`"${domain}" does not look like a domain.`);
  process.exit(2);
}

// Cloudflare rather than the system resolver: a local DNS cache will happily
// serve a record that was deleted an hour ago, which is the exact failure this
// script is meant to catch.
const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

async function txt(host) {
  try {
    return (await resolver.resolveTxt(host)).map((chunks) => chunks.join(''));
  } catch {
    return [];
  }
}

// --- the app itself -------------------------------------------------------
try {
  // `/start`, not `/`: since ADR 0052 the bare host is the marketing site, which
  // sends its own referrer policy. `/start` is an app route, and the app routes
  // are the ones that carry invite secrets (SUS-144).
  const res = await fetch(`https://${domain}/start`, { method: 'GET', redirect: 'follow' });
  record('HTTPS serves the app', res.ok, `${res.status} ${res.statusText}`);

  const hsts = res.headers.get('strict-transport-security');
  record(
    'HSTS header',
    Boolean(hsts) && /max-age=\d{6,}/.test(hsts ?? ''),
    hsts ?? 'absent — EAS Hosting sets this once the domain is attached',
  );

  const referrer = res.headers.get('referrer-policy');
  // Invite secrets ride in the URL fragment; a leaked referrer is how they escape (§14).
  record(
    'Referrer-Policy: no-referrer',
    referrer === 'no-referrer',
    referrer ?? 'absent — required before invite links are shared (§14)',
  );

  // The policy is the second wall behind a session that lives in localStorage
  // on web (SUS-119). Report-Only is not enforcement, so it does not pass.
  const csp = res.headers.get('content-security-policy');
  const directive = (name) =>
    (csp ?? '')
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `));
  const scripts = directive('script-src') ?? '';
  record(
    'Content-Security-Policy',
    Boolean(csp) &&
      directive('default-src') !== undefined &&
      scripts !== '' &&
      !/'unsafe-(inline|eval)'/.test(scripts),
    csp
      ? `${csp.slice(0, 60)}…`
      : res.headers.get('content-security-policy-report-only')
        ? 'only Content-Security-Policy-Report-Only, which blocks nothing'
        : 'absent — see apps/app/app.config.ts',
  );
  record(
    'CSP frame-ancestors',
    directive('frame-ancestors') === "frame-ancestors 'none'",
    directive('frame-ancestors') ?? 'absent — the app can be framed',
  );

  const nosniff = res.headers.get('x-content-type-options');
  record('X-Content-Type-Options: nosniff', nosniff === 'nosniff', nosniff ?? 'absent');

  const permissions = res.headers.get('permissions-policy');
  record(
    'Permissions-Policy',
    /camera=\(\)/.test(permissions ?? '') &&
      /microphone=\(\)/.test(permissions ?? '') &&
      /geolocation=\(\)/.test(permissions ?? ''),
    permissions ?? 'absent — camera, microphone and geolocation should be off',
  );
} catch (error) {
  record('HTTPS serves the app', false, error instanceof Error ? error.message : String(error));
}

// --- the website at the bare host -----------------------------------------
// ADR 0052: `/` is the marketing page, a static document with its own headers:
// a public cache and `strict-origin-when-cross-origin` (it carries no secret),
// where the app routes above send `no-store` and `no-referrer`. Each is held to
// its own expectation, so neither passes for the other's.
try {
  const res = await fetch(`https://${domain}/`, { method: 'GET', redirect: 'follow' });
  record('Website serves /', res.ok, `${res.status} ${res.statusText}`);

  const hsts = res.headers.get('strict-transport-security');
  record(
    'Website HSTS header',
    Boolean(hsts) && /max-age=\d{6,}/.test(hsts ?? ''),
    hsts ?? 'absent',
  );

  const referrer = res.headers.get('referrer-policy');
  record(
    'Website Referrer-Policy: strict-origin-when-cross-origin',
    referrer === 'strict-origin-when-cross-origin',
    referrer ?? 'absent',
  );

  const csp = res.headers.get('content-security-policy') ?? '';
  record(
    'Website CSP: no script, not frameable',
    csp !== '' &&
      !/script-src/.test(csp) &&
      /default-src 'none'/.test(csp) &&
      /frame-ancestors 'none'/.test(csp),
    csp !== '' ? `${csp.slice(0, 60)}…` : 'absent',
  );

  const nosniff = res.headers.get('x-content-type-options');
  record('Website X-Content-Type-Options: nosniff', nosniff === 'nosniff', nosniff ?? 'absent');
} catch (error) {
  record('Website serves /', false, error instanceof Error ? error.message : String(error));
}

// --- email authentication on the sending subdomain ------------------------
if (skipEmail) {
  console.log(`\n${domain}  (email checks skipped: --no-email)`);
} else {
  const mail = `mail.${domain}`;

  // Resend puts SPF and the bounce MX on a `send.` child of the sending domain,
  // not on the sending domain itself, and keeps DKIM at the parent. Checking
  // only one of the two produces a confident, wrong failure.
  const spfHosts = [`send.${mail}`, mail];
  let spfHost = null;
  let spf = [];
  for (const host of spfHosts) {
    const found = (await txt(host)).filter((v) => v.toLowerCase().startsWith('v=spf1'));
    if (found.length > 0) {
      spfHost = host;
      spf = found;
      break;
    }
  }
  record(
    'SPF',
    spf.length === 1,
    spf.length > 0 ? `${spfHost}: ${spf[0]}` : `no v=spf1 at ${spfHosts.join(' or ')}`,
  );

  // Resend publishes its DKIM key at this selector, on the sending domain.
  const dkim = await txt(`resend._domainkey.${mail}`);
  record(
    'DKIM',
    dkim.length > 0,
    dkim.length > 0 ? `resend._domainkey.${mail}` : `nothing at resend._domainkey.${mail}`,
  );

  // Bounces and complaints come back over SMTP; without this Resend cannot tell
  // a hard bounce from silence, and the suppression list never fills.
  let mx = [];
  try {
    mx = await resolver.resolveMx(`send.${mail}`);
  } catch {
    mx = [];
  }
  record(
    'Bounce MX',
    mx.length > 0,
    mx.length > 0 ? `send.${mail} -> ${mx[0]?.exchange}` : `nothing at send.${mail}`,
  );

  const dmarc = (await txt(`_dmarc.${mail}`)).filter((v) => v.toLowerCase().startsWith('v=dmarc1'));
  const policy = /p=(\w+)/.exec(dmarc[0] ?? '')?.[1];
  record(
    'DMARC',
    dmarc.length === 1,
    dmarc.length === 1
      ? `_dmarc.${mail}: p=${policy}${policy === 'none' ? ' (raise to quarantine after warm-up)' : ''}`
      : `no v=DMARC1 at _dmarc.${mail}`,
  );
}

// --- report ---------------------------------------------------------------
const width = Math.max(...results.map((r) => r.name.length));
if (!skipEmail) console.log(`\n${domain}`);
console.log('');
for (const { name, ok, detail } of results) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(width)}  ${detail}`);
}

const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? `\nAll ${results.length} checks passed.\n`
    : `\n${failed.length} of ${results.length} checks failed. See docs/runbooks/environment-setup.md.\n`,
);
process.exit(failed.length === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Checks a *deployed* environment from the outside: does the domain serve the
 * app over HTTPS with HSTS, and is the sending subdomain authenticated for
 * email (architecture §5.2, §14)?
 *
 * Run by hand after the vendor setup in docs/runbooks/environment-setup.md.
 * Not part of `pnpm check`: it needs the network and a domain that exists.
 *
 *   pnpm check:env example.com
 *
 * Reads nothing secret and sends nothing anywhere except DNS and a HEAD request
 * to the domain itself.
 */

import { Resolver } from 'node:dns/promises';

const domain = process.argv[2] ?? process.env.APP_DOMAIN;
if (!domain) {
  console.error('usage: pnpm check:env <domain>    e.g. pnpm check:env example.com');
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
  const res = await fetch(`https://${domain}/`, { method: 'GET', redirect: 'follow' });
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
} catch (error) {
  record('HTTPS serves the app', false, error instanceof Error ? error.message : String(error));
}

// --- email authentication on the sending subdomain ------------------------
const mail = `mail.${domain}`;

const spf = (await txt(mail)).filter((v) => v.toLowerCase().startsWith('v=spf1'));
record('SPF on ' + mail, spf.length === 1, spf[0] ?? 'no v=spf1 record found');

// Resend publishes its DKIM key at this selector.
const dkim = await txt(`resend._domainkey.${mail}`);
record('DKIM (resend._domainkey)', dkim.length > 0, dkim.length > 0 ? 'present' : 'not found');

const dmarc = (await txt(`_dmarc.${mail}`)).filter((v) => v.toLowerCase().startsWith('v=dmarc1'));
const policy = /p=(\w+)/.exec(dmarc[0] ?? '')?.[1];
record(
  'DMARC on ' + mail,
  dmarc.length === 1,
  dmarc.length === 1
    ? `p=${policy}${policy === 'none' ? ' (raise to quarantine after warm-up)' : ''}`
    : 'no v=DMARC1 record found',
);

// --- report ---------------------------------------------------------------
const width = Math.max(...results.map((r) => r.name.length));
console.log(`\n${domain}\n`);
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

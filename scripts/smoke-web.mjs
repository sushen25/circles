#!/usr/bin/env node
/**
 * Looks at the web build a deploy has just put live, from outside (SUS-144).
 *
 *   node scripts/smoke-web.mjs --origin https://app.example [--wait 120]
 *
 * Two requests, no credentials:
 *
 * 1. `/start` is the app's shell: an HTML page with the React root and the web
 *    bundle. The bare host is the marketing site (ADR 0052), so it is the wrong
 *    page to judge the app by.
 * 2. `/j/abc234` as a chat app's crawler: the preview card must name the
 *    configured origin in `og:image` and in its refresh, never the
 *    per-deployment `*.expo.app` host (SUS-128). An unknown code is enough: the
 *    card is generic, but it is built from the same origin.
 *
 * The CDN can take a little while to serve a new deployment, so both are retried
 * until `--wait` seconds have passed. `pnpm check:env` does the headers and DNS.
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function judgeShell(html) {
  const text = String(html ?? '');
  if (!/<!doctype html/i.test(text)) return { ok: false, detail: 'not an HTML document' };
  if (!/<div id="root"/.test(text))
    return { ok: false, detail: 'no <div id="root"> (not the app shell)' };
  const bundle = /<script[^>]+src="(\/_expo\/static\/js\/web\/[^"]+)"/.exec(text)?.[1];
  if (!bundle) {
    return { ok: false, detail: 'no web bundle script (an export that did not finish)' };
  }
  return { ok: true, detail: 'the app shell with its bundle', bundle };
}

export function judgePreview(html, origin) {
  const text = String(html ?? '');
  const image = /property="og:image"\s+content="([^"]*)"/.exec(text)?.[1];
  const refresh = /http-equiv="refresh"\s+content="[^"]*?url=([^"]*)"/i.exec(text)?.[1];
  if (!image) return { ok: false, detail: 'no og:image in the preview card' };
  if (!refresh) return { ok: false, detail: 'no refresh in the preview card' };
  for (const [what, url] of [
    ['og:image', image],
    ['refresh', refresh],
  ]) {
    if (/\.expo\.app/i.test(url))
      return { ok: false, detail: `${what} names the vendor host: ${url}` };
    if (!url.startsWith(`${origin}/`))
      return { ok: false, detail: `${what} is ${url}, not on ${origin}` };
  }
  return { ok: true, detail: `og:image and refresh are on ${origin}` };
}

async function getHead(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status} ${res.statusText}`);
  await res.arrayBuffer();
  return { type: res.headers.get('content-type') ?? '' };
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

export async function smoke(
  origin,
  { wait = 0, sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)) } = {},
) {
  const checks = [
    [
      'app shell at /start',
      async () => {
        const shell = judgeShell(await get(`${origin}/start`));
        if (!shell.ok) return shell;
        // A shell that points at a bundle which 404s is an app that cannot load.
        const { type } = await getHead(`${origin}${shell.bundle}`);
        return /javascript/i.test(type)
          ? { ok: true, detail: `the app shell, and its bundle ${shell.bundle} loads` }
          : {
              ok: false,
              detail: `the bundle ${shell.bundle} is served as '${type}', not JavaScript`,
            };
      },
    ],
    [
      'preview card at /j/abc234',
      () => get(`${origin}/j/abc234`, { 'user-agent': 'WhatsApp/2.24.16.78 A' }),
      (html) => judgePreview(html, origin),
    ],
  ];
  const results = [];
  for (const [name, fetchIt, judge = (r) => r] of checks) {
    const deadline = Date.now() + wait * 1000;
    let result;
    for (;;) {
      try {
        result = judge(await fetchIt());
      } catch (error) {
        result = { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
      if (result.ok || Date.now() >= deadline) break;
      await sleep(10);
    }
    results.push({ name, ...result });
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) =>
    argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined;
  const origin = opt('origin');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin ?? '')) {
    console.error('usage: smoke-web.mjs --origin https://<host> [--wait <seconds>]');
    process.exit(2);
  }
  const results = await smoke(origin, { wait: Number(opt('wait') ?? 0) || 0 });
  const lines = results.map((r) => `- ${r.ok ? 'ok' : '**FAILED**'}: ${r.name}: ${r.detail}`);
  const text = `### Smoke test of ${origin}\n\n${lines.join('\n')}`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  if (results.some((r) => !r.ok)) {
    console.error(
      '\nsmoke-web: the deploy has landed and the web host is not serving it correctly. Roll back or fix forward (docs/runbooks/production-deploy.md).',
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

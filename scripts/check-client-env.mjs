#!/usr/bin/env node
/**
 * Refuses to build a client that cannot reach its backend.
 *
 * `expo export` is perfectly happy with an undefined `EXPO_PUBLIC_SUPABASE_URL`:
 * it compiles, deploys, serves, and every request fails at runtime in the
 * browser. That is the most expensive way to find out a variable is missing, so
 * this runs first and says which one it is.
 *
 * Public values only — this never sees a secret, by design (architecture §5.3).
 * Run it with the same environment the build will get.
 */

const REQUIRED = [
  {
    name: 'EXPO_PUBLIC_SUPABASE_URL',
    check: (v) => (/^https?:\/\//.test(v) ? null : 'must be an http(s) URL'),
    where: 'Supabase dashboard → Project Settings → API → Project URL',
  },
  {
    name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    // Publishable by design; length is the only cheap sanity check.
    check: (v) => (v.length >= 40 ? null : 'looks too short to be a real key'),
    where: 'Supabase dashboard → Project Settings → API → anon/publishable key',
  },
  {
    name: 'EXPO_PUBLIC_APP_ORIGIN',
    check: (v) =>
      /^https:\/\//.test(v) || v.startsWith('http://localhost')
        ? v.endsWith('/')
          ? 'must not end in a slash — it is joined to paths directly'
          : null
        : 'must be an https URL (or http://localhost for local runs)',
    where: 'the domain the app is served from, e.g. https://example.com',
  },
];

// Turnstile gates anonymous joins (§14). Missing on dev is a nuisance; missing
// on production means the join flow is open to anything that can POST.
//
// Cloudflare's documented dummy sitekeys — `1x`/`2x`/`3x` followed by twenty
// zeroes and two letters — are the right thing to develop against and the
// wrong thing to deploy: the always-passes pair lets every caller through
// while looking, from here, exactly like a configured widget. `length > 0` was
// the whole production guard, and a dummy key satisfies it. It has to be a
// separate refusal rather than a stricter format check, because the useful
// half of the message is *which* key this is, not that it is malformed.
const DUMMY_SITEKEY = /^[123]x0{20}[A-Z]{2}$/;

const TURNSTILE = {
  name: 'EXPO_PUBLIC_TURNSTILE_SITE_KEY',
  where: 'Cloudflare dashboard → Turnstile → the widget for this domain',
};

const required = [...REQUIRED];
if (process.env.REQUIRE_TURNSTILE === 'true') {
  required.push({
    ...TURNSTILE,
    check: (v) => {
      if (v.length === 0) return 'is empty';
      if (DUMMY_SITEKEY.test(v)) {
        return `is Cloudflare's test key ${v}, which gates nothing — every caller passes`;
      }
      return null;
    },
  });
}

const problems = [];
for (const { name, check, where } of required) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    problems.push(`  ${name} is not set — ${where}`);
    continue;
  }
  const complaint = check(value);
  if (complaint) problems.push(`  ${name} ${complaint} — ${where}`);
}

if (problems.length > 0) {
  console.error('Client configuration is incomplete:\n');
  console.error(problems.join('\n'));
  console.error(
    '\nSet these as GitHub Actions *variables* (not secrets — they ship in the\n' +
      'bundle and are readable by anyone). Repository variables hold the `dev`\n' +
      'values; the `production` environment overrides them with the live ones.\n' +
      'See docs/runbooks/environments.md.',
  );
  process.exit(1);
}

console.log(`Client configuration ok (${required.length} variables checked).`);

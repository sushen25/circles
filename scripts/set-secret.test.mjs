// Run by `pnpm check:workflows` with `node --test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A stand-in for the Supabase CLI that records its argv and the env file it was
// handed, so the test sees what the real one would have been given.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'set-secret-'));
  const fake = join(dir, 'supabase');
  writeFileSync(
    fake,
    `#!/usr/bin/env bash
echo "$@" > "${dir}/argv"
for a in "$@"; do case "$a" in *.env) cp "$a" "${dir}/seen.env"; echo "$a" > "${dir}/envpath";; esac; done
`,
  );
  chmodSync(fake, 0o755);
  return { dir, fake };
}

const run = (input, env = {}, key = 'INVITE_LINK_KEY') => {
  const { dir, fake } = fixture();
  const result = spawnSync('bash', ['scripts/set-secret.sh', key], {
    input,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE: fake, REF: 'abcdefghij', ENV_NAME: 'dev', ...env },
  });
  return { ...result, dir };
};

test('the value comes from stdin and never reaches a command line', () => {
  const r = run('s3cr3t-value\n');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(r.dir, 'seen.env'), 'utf8'), "INVITE_LINK_KEY='s3cr3t-value'\n");
  assert.ok(!readFileSync(join(r.dir, 'argv'), 'utf8').includes('s3cr3t-value'));
  assert.match(readFileSync(join(r.dir, 'argv'), 'utf8'), /--project-ref abcdefghij/);
  assert.ok(!r.stdout.includes('s3cr3t-value'));
});

test('a multi-line value (a .p8 key) arrives whole, and the env file is removed', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----\n';
  const r = run(pem);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    readFileSync(join(r.dir, 'seen.env'), 'utf8'),
    `INVITE_LINK_KEY='${pem.trimEnd()}'\n`,
  );
  assert.equal(existsSync(readFileSync(join(r.dir, 'envpath'), 'utf8').trim()), false);
});

test('an empty value is refused and nothing is sent', () => {
  const r = run('');
  assert.equal(r.status, 2);
  assert.equal(existsSync(join(r.dir, 'argv')), false);
});

test('GENERATE=1 invents a value without reading stdin', () => {
  const r = run('', { GENERATE: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    readFileSync(join(r.dir, 'seen.env'), 'utf8'),
    /^INVITE_LINK_KEY='[A-Za-z0-9+/=]{44}'\n$/,
  );
  assert.ok(!r.stdout.includes(readFileSync(join(r.dir, 'seen.env'), 'utf8').split("'")[1]));
});

test('a bad name, or a value with a single quote, is refused', () => {
  assert.equal(run('x', {}, 'bad name').status, 2);
  assert.equal(run('x', {}, '').status, 2);
  assert.equal(run("it's").status, 2);
});

test('make secret refuses V= and says what to do', () => {
  const r = spawnSync('make', ['secret', 'ENV=dev', 'K=X', 'V=nope'], { encoding: 'utf8' });
  // The guard is the first thing the recipe checks, so nothing is ever sent.
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /V= is gone/);
});

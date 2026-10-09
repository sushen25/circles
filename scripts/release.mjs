#!/usr/bin/env node
/**
 * Names, finds and records what production is running (SUS-144).
 *
 *   node scripts/release.mjs resolve --head <sha> [--tag <prod-tag>]
 *   node scripts/release.mjs tag --sha <sha>
 *
 * `resolve` runs in the `plan` job. With no `--tag` it answers "deploy the
 * dispatched commit"; with one it answers "redeploy what that tag points at",
 * after checking the tag is one of ours, that it still points at the commit its
 * own name says, and that the commit is an ancestor of the dispatched one. It
 * prints `sha=`, `rollback=` and `tag=` lines for `$GITHUB_OUTPUT`.
 *
 * `tag` runs in the `tag` job, after `apply` has succeeded, and pushes
 * `prod-<yyyymmdd>-<shortsha>` for the deployed commit. Tagging again the same
 * commit is a no-op; a name already used for another commit is a failure.
 *
 * Tags are a convenience for people. The source of truth for "what is live" in
 * `prod-plan.mjs` stays GitHub's deployments API, which a rollback also writes.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TAG_PATTERN = /^prod-(\d{8})-([0-9a-f]{7})$/;

/** `prod-20261009-2c0f807` for a UTC date and a full sha. */
export function tagFor(date, sha) {
  const day = date.toISOString().slice(0, 10).replaceAll('-', '');
  return `prod-${day}-${sha.slice(0, 7)}`;
}

export const isProdTag = (name) => TAG_PATTERN.test(name ?? '');

/**
 * Whether `sha` is the commit the tag's own name claims. A tag that was moved
 * (or made by hand on another commit) must not be redeployed as if it were the
 * release it is called.
 */
export function tagMatchesSha(tag, sha) {
  const m = TAG_PATTERN.exec(tag ?? '');
  return Boolean(m) && /^[0-9a-f]{40}$/.test(sha ?? '') && sha.startsWith(m[2]);
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const ok = (...a) => {
  try {
    execFileSync('git', a, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

function summary(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

export function resolve({ head, tag }) {
  if (!/^[0-9a-f]{40}$/.test(head ?? '')) throw new Error('--head must be a full 40-character sha');
  if (!tag) return { sha: head, rollback: 'false', tag: '' };
  if (!isProdTag(tag)) {
    throw new Error(
      `"${tag}" is not a production tag (prod-<yyyymmdd>-<7 hex>); see git tag -l 'prod-*'`,
    );
  }
  if (!ok('rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`)) {
    throw new Error(`no tag ${tag} in this clone; list them with git tag -l 'prod-*'`);
  }
  const sha = git('rev-parse', `refs/tags/${tag}^{commit}`);
  if (!tagMatchesSha(tag, sha)) {
    throw new Error(
      `${tag} points at ${sha}, which its name does not match: it was moved or made by hand`,
    );
  }
  if (!ok('merge-base', '--is-ancestor', sha, head)) {
    throw new Error(
      `${tag} (${sha}) is not an ancestor of the dispatched commit, so it was not released from this history`,
    );
  }
  return { sha, rollback: 'true', tag };
}

export function tagRelease({ sha, now = new Date(), remote = 'origin' }) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('--sha must be a full 40-character sha');
  const name = tagFor(now, sha);
  const existing = ok('rev-parse', '--verify', '--quiet', `refs/tags/${name}^{commit}`)
    ? git('rev-parse', `refs/tags/${name}^{commit}`)
    : null;
  if (existing && existing !== sha) {
    throw new Error(`${name} already exists on ${existing}, not ${sha}`);
  }
  if (!existing) git('tag', name, sha);
  execFileSync('git', ['push', remote, `refs/tags/${name}`], { stdio: 'inherit' });
  return name;
}

function main() {
  const [command, ...argv] = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  if (command === 'resolve') {
    const r = resolve({ head: opt('head'), tag: opt('tag') });
    const lines = [`sha=${r.sha}`, `rollback=${r.rollback}`, `tag=${r.tag}`];
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    summary(
      r.rollback === 'true'
        ? `### Rollback\n\nRedeploying \`${r.tag}\` (\`${r.sha}\`). Migrations are not touched: the database keeps every migration it has.`
        : `### Deploy\n\nDeploying the dispatched commit \`${r.sha}\`.`,
    );
    return;
  }
  if (command === 'tag') {
    const name = tagRelease({ sha: opt('sha') });
    summary(
      `### Released as \`${name}\`\n\nTo go back to this release later, dispatch \`deploy-prod\` with \`rollback_to\` = \`${name}\` (docs/runbooks/production-deploy.md, "Rolling back").`,
    );
    return;
  }
  console.error('usage: release.mjs resolve --head <sha> [--tag <tag>] | tag --sha <sha>');
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`release: ${error?.message ?? error}`);
    process.exit(1);
  }
}

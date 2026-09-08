#!/usr/bin/env node
/**
 * Pulls the deployment URL out of `eas deploy --json` output, read from stdin.
 *
 * Written because the inline version — `| tail -1 | node -e 'JSON.parse(...)'` —
 * failed silently: the output is pretty-printed, so the last line is `}`, the
 * parse threw, the catch printed an empty string and the "here is your preview"
 * comment quietly skipped. A deploy nobody can find is a deploy that did not
 * happen, so this fails loudly instead.
 *
 * Tolerates leading noise from pnpm, multi-line JSON, and a plain-text CLI that
 * has stopped emitting JSON at all.
 */

const raw = await new Promise((resolve) => {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (buffer += chunk));
  process.stdin.on('end', () => resolve(buffer));
});

const URL_KEYS = ['url', 'dashboardUrl', 'deploymentUrl', 'aliasUrl'];

function fromJson(text) {
  // The JSON object may be preceded by pnpm's own chatter, so start at the
  // first brace and try progressively shorter suffixes for a trailing banner.
  const start = text.indexOf('{');
  if (start === -1) return null;
  const candidate = text.slice(start);
  for (let end = candidate.length; end > 1; end = candidate.lastIndexOf('}', end - 1)) {
    try {
      const parsed = JSON.parse(candidate.slice(0, end));
      for (const key of URL_KEYS) {
        if (typeof parsed?.[key] === 'string') return parsed[key];
      }
      return null;
    } catch {
      // keep shrinking
    }
  }
  return null;
}

// Last resort: the CLI printed a human-readable line with the URL in it.
function fromText(text) {
  const matches = text.match(/https:\/\/[^\s"']+/g) ?? [];
  return matches.find((u) => u.includes('.expo.app')) ?? null;
}

const url = fromJson(raw) ?? fromText(raw);

if (!url) {
  console.error('deploy-url: no deployment URL in the eas output. Raw output was:\n');
  console.error(raw.slice(0, 4000));
  process.exit(1);
}

console.log(url);

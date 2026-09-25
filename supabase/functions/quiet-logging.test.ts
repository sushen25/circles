import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * No log line in any Edge Function names a quiet ask's initiator (spec §5.4,
 * architecture §14; S2-02's acceptance criterion).
 *
 * Read from the source rather than from a run, because the promise is about
 * every line that *could* be written, not the ones a test happened to reach:
 * every `log(…)` call's argument, in every module under `supabase/functions`,
 * is searched for the word, and for the two ways the initiator reaches a
 * function — `quietInitiatorId`, and `initiator_user_id` from
 * `dispatch_quiet_audience`. A log call is structured (`_shared/logging.ts`),
 * so its argument is the whole of what it can say.
 */

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const FORBIDDEN = /initiator|keen_user_ids|keenMemberIds/i;

function sources(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__snapshots__') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, into);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) into.push(path);
  }
  return into;
}

/** Every `log(` / `console.*(` call in `text`, as the source of its whole argument list. */
function logCalls(text: string): string[] {
  const calls: string[] = [];
  const opener = /\b(?:log|console\.(?:log|info|warn|error|debug))\s*\(/g;
  for (let match = opener.exec(text); match !== null; match = opener.exec(text)) {
    let depth = 1;
    let at = match.index + match[0].length;
    while (at < text.length && depth > 0) {
      const char = text[at];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      at += 1;
    }
    calls.push(text.slice(match.index, at));
  }
  return calls;
}

describe('function logs', () => {
  const files = sources(ROOT);

  it('finds the log calls it is meant to be reading', () => {
    // A guard that matches nothing passes for ever. The dispatcher alone logs
    // a dozen times; if this reads none, the pattern is what broke.
    const total = files.reduce((n, file) => n + logCalls(readFileSync(file, 'utf8')).length, 0);
    expect(total).toBeGreaterThan(20);
  });

  it('never name the initiator of a quiet ask, or who was keen', () => {
    const offending = files.flatMap((file) =>
      logCalls(readFileSync(file, 'utf8'))
        .filter((call) => FORBIDDEN.test(call))
        .map((call) => `${relative(ROOT, file)}: ${call.replace(/\s+/g, ' ')}`),
    );
    expect(offending).toEqual([]);
  });
});

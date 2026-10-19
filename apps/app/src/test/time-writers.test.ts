import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * One function writes a time of day (SUS-217): `formatMinutesOfDay` /
 * `formatRange` from `@circles/domain`, given `deviceTimeFormat()` in the app.
 * `Intl.DateTimeFormat` with an `hour` writes it a second way (padding and
 * am/pm case differ), so it may appear only where it is not writing a time:
 * the helper that asks which clock the device keeps, and the zone arithmetic
 * that reads an instant's parts.
 */
const ALLOWED = new Set([
  'apps/app/src/platform/timeFormat.ts',
  'packages/domain/src/shared/zone.ts',
]);

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const SOURCES = [
  'apps/app/src',
  'packages/domain/src',
  'packages/contracts/src',
  'supabase/functions',
];

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sources(path, found);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** The text of every `DateTimeFormat(` call, to its closing parenthesis. */
function calls(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/DateTimeFormat\(/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const from = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth -= 1;
      i += 1;
    }
    out.push(text.slice(from, i));
  }
  return out;
}

describe('writing a time of day', () => {
  it('never goes through Intl.DateTimeFormat with an hour, outside the helper', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const dir of SOURCES) {
      for (const file of sources(join(ROOT, dir))) {
        const name = relative(ROOT, file).split(sep).join('/');
        scanned += 1;
        if (ALLOWED.has(name)) continue;
        if (
          calls(readFileSync(file, 'utf8')).some((c) =>
            /\b(hour|hour12|hourCycle|timeStyle)\s*:/.test(c),
          )
        ) {
          offenders.push(name);
        }
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders, 'use formatMinutesOfDay / formatRange with deviceTimeFormat()').toEqual([]);
  });
});

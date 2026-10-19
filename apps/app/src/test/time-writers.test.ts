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
  'apps/app/app',
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

/**
 * Crude on purpose: a file that mentions `DateTimeFormat` may not name an
 * `hour`-ish option anywhere in it (so options passed through a variable or a
 * wrapper are caught too), and no file may use the other ways to write a clock.
 */
const HOUR_OPTION = /['"]?\b(hour|hour12|hourCycle|timeStyle)\b['"]?\s*[:,}]/;
const OTHER_CLOCKS = /\b(toLocaleTimeString|toTimeString)\b|\btimeStyle\b/;

function writesATime(text: string): boolean {
  return OTHER_CLOCKS.test(text) || (/DateTimeFormat/.test(text) && HOUR_OPTION.test(text));
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
        if (writesATime(readFileSync(file, 'utf8'))) offenders.push(name);
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders, 'use formatMinutesOfDay / formatRange with deviceTimeFormat()').toEqual([]);
  });
});

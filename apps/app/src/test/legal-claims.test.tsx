import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { en } from '../copy';
import { LegalScreen } from '../features/identity/LegalScreen';
import { PrivacyScreen } from '../features/identity/PrivacyScreen';

/**
 * S4-05: every retention period the privacy pages state is one the database
 * enforces. It is the one claim a reader cannot check for themselves, so this
 * reads the SQL (`run_retention`, and the purge's own default) and fails on a
 * page that names a period it does not find there. It lives under `test/`
 * because it reads files, which a feature's own test may not (`legal.test.tsx`
 * keeps the rest of the pages' claims).
 */
const textOf = (element: React.ReactElement) => {
  const { container, unmount } = render(element);
  const text = container.textContent ?? '';
  unmount();
  return text;
};

/** A file in the repository, found from wherever the run started (the package or the root). */
function repo(path: string): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('not inside the workspace');
    dir = up;
  }
  return readFileSync(join(dir, path), 'utf8');
}

/** `12 months`, `30 days`: a period as `run_retention` writes it, in one spelling. */
const normal = (n: string, unit: string) => `${n} ${unit.replace(/s$/, '')}${n === '1' ? '' : 's'}`;

/** The periods the database enforces: every interval in `run_retention`, and the purge's own. */
function enforced(): Set<string> {
  const periods = new Set<string>();
  const sql = repo('supabase/sql/functions/jobs/run_retention.sql');
  for (const [, n, unit] of sql.matchAll(/interval '(\d+) (days?|months?|years?)'/g)) {
    periods.add(normal(n!, unit!));
  }
  const migration = repo('supabase/migrations/0071_account_deletion.sql');
  const purge = /purge_after timestamptz[^\n]*interval '(\d+) (days?|months?|years?)'/.exec(
    migration,
  );
  expect(purge, 'the purge period is still where this test reads it').not.toBeNull();
  periods.add(normal(purge![1]!, purge![2]!));
  return periods;
}

/** The periods a page states, as digits and a unit: `12 months`, `1 day`. */
const stated = (text: string) =>
  [...text.matchAll(/\b(\d+) (days?|months?|years?)\b/g)].map(([, n, unit]) => normal(n!, unit!));

describe('the periods the pages state', () => {
  it('/privacy states only periods the database enforces, and the ones it does not are open', () => {
    const text = textOf(<LegalScreen kind="privacy" />);
    const known = enforced();

    for (const period of stated(text)) {
      expect(known.has(period), `"${period}" is not a period run_retention enforces`).toBe(true);
    }
    for (const period of ['12 months', '30 days', '7 days', '90 days', '1 day']) {
      expect(stated(text), period).toContain(period);
      expect(known.has(period), period).toBe(true);
    }

    // Undecided, so named as undecided and given no number.
    const open = en.legal.privacy_retain_open;
    expect(open).toMatch(/^Still being decided: /);
    for (const undecided of ['notes', 'place names', 'analytics events', 'archived', 'guests']) {
      expect(open, undecided).toContain(undecided);
    }
    expect(stated(open)).toEqual([]);
  });

  it('/terms and /settings/privacy state only periods the database enforces', () => {
    const known = enforced();
    const terms = textOf(<LegalScreen kind="terms" />);
    const settings = textOf(<PrivacyScreen />);

    expect(stated(terms)).toContain('12 months');
    expect(stated(settings)).toContain('12 months');
    for (const period of [...stated(terms), ...stated(settings)]) {
      expect(known.has(period), `"${period}" is not a period run_retention enforces`).toBe(true);
    }
  });
});

import { defineConfig } from 'vitest/config';

// One runner for the whole workspace: `pnpm test:unit` at the root executes
// every package's suite. Each package owns its own project config so it can be
// run in isolation too (`pnpm --filter @circles/domain test`).

// The device's time zone is part of a test's input (SUS-137). A suite that
// reads "today" from the machine passed in CI, which is UTC, and failed on a
// laptop in Sydney between midnight and 10:00, when the local date is a day
// ahead. Unless the run names a zone (`TZ=Australia/Sydney pnpm test:unit`, to
// look for exactly that), it is UTC, whatever machine it runs on.
process.env.TZ ??= 'UTC';

export default defineConfig({
  test: {
    // `supabase/functions` is named rather than globbed: the glob would also
    // match `supabase/migrations` and `supabase/tests`, which hold SQL.
    projects: ['packages/*', 'apps/*', 'supabase/functions'],
  },
});

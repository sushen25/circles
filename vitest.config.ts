import { defineConfig } from 'vitest/config';

// One runner for the whole workspace: `pnpm test:unit` at the root executes
// every package's suite. Each package owns its own project config so it can be
// run in isolation too (`pnpm --filter @circles/domain test`).
export default defineConfig({
  test: {
    // `supabase/functions` is named rather than globbed: the glob would also
    // match `supabase/migrations` and `supabase/tests`, which hold SQL.
    projects: ['packages/*', 'apps/*', 'supabase/functions'],
  },
});

# supabase/functions

Deno Edge Functions, one folder per use case (architecture §7.4). Land in
**S0-06** (local stack, import map) and **S1-13** onwards (the functions
themselves).

This folder is a pnpm workspace member so shared dev dependencies resolve from
the root. Functions import `@circles/domain` through an import map pointing at
the package's built ESM output — hence `packages/domain` is built with
`tsc -b` and keeps explicit `.js` extensions on relative imports.

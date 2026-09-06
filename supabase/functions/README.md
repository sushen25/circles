# supabase/functions

Deno Edge Functions, one folder per use case (architecture §7.4). Land in
**S0-06** (local stack, import map) and **S1-13** onwards (the functions
themselves).

This folder is a pnpm workspace member so shared dev dependencies resolve from
the root. Functions import `@circles/domain` and `@circles/contracts` through
`import_map.json`, referenced by each function's `deno.json` — hence the
packages are built with `tsc -b` and keep explicit `.js` extensions on relative
imports. See [`../README.md`](../README.md) for the details and the reason it
has to be wired that way.

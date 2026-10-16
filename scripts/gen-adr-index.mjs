// Writes docs/decisions/index.md from the ADRs' frontmatter. `--check` exits 1
// instead of writing when the file would change (order of rows aside, see
// check-docs.mjs). Part of `pnpm gen`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { INDEX, renderIndex } from './adrs.mjs';

const next = renderIndex();
const current = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : null;
if (process.argv.includes('--check')) {
  if (current !== next) {
    console.error('gen:adrs: docs/decisions/index.md is stale; run `pnpm gen:adrs`');
    process.exit(1);
  }
  console.log('gen:adrs: index is current');
} else if (current === next) {
  console.log('gen:adrs: index already current');
} else {
  writeFileSync(INDEX, next);
  console.log('gen:adrs: wrote docs/decisions/index.md');
}

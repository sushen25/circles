// `pnpm gen:migration <name>`: the next numbered migration, empty, for the
// generators to find (SUS-141). See `migrations.mjs`.
import { createMigration } from './migrations.mjs';

createMigration(process.argv[2]);

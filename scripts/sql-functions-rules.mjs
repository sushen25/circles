// The rules a function file has to satisfy, and the rendering of the tree into
// a migration. Kept apart from the command that runs them (gen-sql-functions.mjs)
// and from the cases that prove they fire (sql-functions-cases.mjs), because
// they are three jobs and AGENTS.md asks for files under ~300 lines split by
// responsibility.
//
// Everything here is a pure function over a map of `repo-relative path →
// contents`, never over the disk, so the cases can hand it a tree that does
// not exist. How the SQL itself is read lives in `sql-functions-syntax.mjs`.
import {
  BEGIN,
  BULK_ACL,
  END,
  TOUCHES,
  blockSpans,
  createdIn,
  normalise,
  operations,
} from './sql-functions-syntax.mjs';

// Re-exported so the command has one place to import from.
export { BEGIN, END } from './sql-functions-syntax.mjs';

// Deliberately lenient about everything Postgres is lenient about, because
// this is a guard and what it guards against is somebody writing SQL the
// ordinary way: `CREATE OR REPLACE FUNCTION` in caps, a bare `create
// function`, an indented statement, a quoted identifier. Strict matching would
// mean the rule only catches the house style, which is the one form that was
// never the risk.

function checkSourceFile(where, sql, sources, problems) {
  const defined = createdIn(sql);
  if (defined.length !== 1) {
    problems.push(
      `${where}: expected exactly one "create or replace function", found ${defined.length}. ` +
        'One function per file is what makes the filename an index.',
    );
    return;
  }

  const name = defined[0];
  if (!name.includes('.')) {
    problems.push(`${where}: defines ${name} with no schema — write \`schema.name\`.`);
    return;
  }
  const [schema, short] = name.split('.');
  const expected = `supabase/sql/functions/${schema}/${short}.sql`;
  if (where !== expected) {
    problems.push(`${where}: defines ${name}, so it belongs at ${expected}.`);
  }
  if (sources.has(name)) {
    problems.push(`${name} is defined in two files: ${sources.get(name).where} and ${where}.`);
  }

  // Who may call it, decided rather than defaulted. Postgres grants `execute`
  // on a new function to PUBLIC and Supabase's default privileges grant it to
  // the client roles by name; neither goes away on its own, and a function
  // that says nothing is a function anyone can call. `from public` is always
  // required and a grant back to PUBLIC undoes it; each client role must then
  // be either revoked or granted, so the answer is in the file rather than in
  // whatever the defaults happened to be.
  const acl = sql
    .split('\n')
    .filter((line) => /^\s*(revoke|grant)\b/.test(line) || /^\s+(from|to)\b/.test(line))
    .join(' ');
  if (!/revoke[^;]*\bfrom\b[^;]*\bpublic\b/.test(acl)) {
    problems.push(
      `${where}: no "revoke ... from public" — PUBLIC keeps the execute Postgres gave it.`,
    );
  }
  if (/grant[^;]*\bto\b[^;]*\bpublic\b/.test(acl)) {
    problems.push(`${where}: grants execute to PUBLIC, which is every role there will ever be.`);
  }
  for (const role of ['anon', 'authenticated']) {
    const revoked = new RegExp(`revoke[^;]*\\bfrom\\b[^;]*\\b${role}\\b`).test(acl);
    const granted = new RegExp(`grant[^;]*\\bto\\b[^;]*\\b${role}\\b`).test(acl);
    if (!revoked && !granted) {
      problems.push(`${where}: ${role} is neither revoked nor granted — say which.`);
    }
  }

  sources.set(name, { where, sql });
}

/**
 * A filed function redefined by hand in a migration, outside any generated
 * block, after the tree took over.
 *
 * This is the failure ADR 0015 exists to prevent, in its quietest form: the
 * hand-written definition is what the database ends up running, the file still
 * matches whatever the generator last wrote, so nothing drifts and nothing
 * complains — and the tree, which the ADR promises is the truth, is a lie. The
 * earlier migrations are exempt because that is where these definitions came
 * from; the rule starts at the first migration that carries a generated block.
 */
function checkHandEdits(migrationFiles, sources, problems) {
  const entries = [...migrationFiles.keys()];
  const firstGenerated = entries.find((entry) => blockSpans(migrationFiles.get(entry)).length > 0);
  if (firstGenerated === undefined) return;

  for (const entry of entries.slice(entries.indexOf(firstGenerated))) {
    const sql = migrationFiles.get(entry);
    const spans = blockSpans(sql);
    const outside = (at) => !spans.some(([start, finish]) => at >= start && at < finish);
    const handled = new Set();

    for (const { name, at, dropping } of operations(sql)) {
      if (dropping || !sources.has(name) || !outside(at)) continue;
      handled.add(name);
      problems.push(
        `${entry} defines ${name} by hand, outside the generated block, and ${sources.get(name).where} ` +
          'is supposed to be where that definition lives. The database would run the migration ' +
          'and the tree would never know. Move the change into the file and run `pnpm gen:functions`.',
      );
    }

    for (const match of sql.matchAll(BULK_ACL)) {
      if (!outside(match.index)) continue;
      problems.push(
        `${entry} changes the grants on every function in schema ${normalise(match[1])} at once, ` +
          'outside any generated block. That reaches the filed ones too, and none of their files ' +
          'would say so. Grant per function, in the file that holds it.',
      );
    }

    for (const match of sql.matchAll(TOUCHES)) {
      const name = normalise(match[1]);
      if (!sources.has(name) || handled.has(name) || !outside(match.index)) continue;
      handled.add(name);
      problems.push(
        `${entry} changes ${name}'s grants, comment or attributes by hand, outside the generated ` +
          `block. Those belong in ${sources.get(name).where} with the body — "what is this and who ` +
          'may call it" is meant to be one file — so make the change there and run ' +
          '`pnpm gen:functions`.',
      );
    }
  }
}

function checkMigrations(migrationFiles, sources, problems) {
  const history = new Map();
  for (const [entry, sql] of migrationFiles) {
    for (const { name, signature, dropping } of operations(sql)) {
      const seen = history.get(name) ?? { signatures: new Set(), entry };
      if (!dropping) seen.signatures.add(signature);
      history.set(name, {
        signatures: seen.signatures,
        dropping,
        entry: dropping ? seen.entry : entry,
      });
    }
  }

  for (const [name, { signatures, dropping, entry }] of history) {
    if (sources.has(name)) continue;
    if (!dropping) {
      problems.push(
        `${name} is defined in ${entry} but has no file under supabase/sql/functions/. ` +
          'Move the definition there and run `pnpm gen:functions`.',
      );
    } else if (signatures.size > 1) {
      // Overloads only. A name created repeatedly with one signature is a
      // redefinition, and a drop ends it cleanly. Two signatures and a drop is
      // ambiguous — the tree is keyed by name and cannot hold both — so it
      // says so rather than guessing in the permissive direction. It may also
      // be one signature this script cannot see is one, which is why the
      // message offers that exit too.
      problems.push(
        `${name} has ${signatures.size} signatures in the migrations and was then dropped, so ` +
          'the tree cannot say which survives. Give the surviving one a file, or drop them ' +
          'all. If they are really one signature spelled two ways — a renamed parameter, ' +
          '`timestamptz` for `timestamp with time zone` — signatureOf() in ' +
          'scripts/sql-functions-rules.mjs is where it learns the difference.',
      );
    }
  }
}

/**
 * Which migrations each half of the work sees.
 *
 * The rules see **all** of them, including the one the generator is writing: a
 * hand-written definition is likeliest to land in exactly that file, and
 * leaving it out meant the one migration somebody is editing was the one
 * nobody checked. The comparison that decides what to re-emit sees all the
 * *others*, because a block cannot be diffed against itself.
 *
 * Exported, and pinned by a case, because this selection was the bug once.
 */
export function migrationsFor(migrationFiles, target) {
  return {
    checked: migrationFiles,
    earlier: new Map([...migrationFiles].filter(([entry]) => entry !== target)),
  };
}

export function analyse(sourceFiles, migrationFiles) {
  const problems = [];
  const sources = new Map();
  for (const [where, raw] of sourceFiles) {
    checkSourceFile(where, raw.trimEnd(), sources, problems);
  }
  checkMigrations(migrationFiles, sources, problems);
  checkHandEdits(migrationFiles, sources, problems);
  return { problems, sources };
}

/** One function's contribution to a generated block: its path, then its file. */
function chunkFor({ where, sql }) {
  return `-- ${where}\n${sql}`;
}

/**
 * What earlier migrations already said, chunk by chunk, in filename order — so
 * the last word wins, as everywhere else here.
 *
 * This is what makes a second functions migration small. `0008` carries all 47
 * definitions because it was the seam; every migration after it should carry
 * only what changed, or a one-line fix to one function would be two and a half
 * thousand lines of `create or replace` that a reviewer cannot read past.
 */
export function priorRenderings(migrationFiles) {
  const prior = new Map();
  for (const [, sql] of migrationFiles) {
    let from = 0;
    for (;;) {
      const start = sql.indexOf(BEGIN, from);
      if (start === -1) break;
      const finish = sql.indexOf(END, start);
      if (finish === -1) break;
      const block = sql.slice(start + BEGIN.length, finish);
      for (const chunk of block.split(/\n\n(?=-- supabase\/sql\/functions\/)/)) {
        const trimmed = chunk.trim();
        const named = /^-- (supabase\/sql\/functions\/\S+)\n/.exec(trimmed);
        if (named) prior.set(named[1], trimmed);
      }
      from = finish + END.length;
    }
  }
  return prior;
}

/**
 * The generated block, and the list of what went into it: every function whose
 * file differs from what the earlier migrations last said about it, and nothing
 * else. A file that has not changed is already in the database from the
 * migration that carried it, and restating it would be noise a reviewer has to
 * read past.
 */
export function render(sources, prior = new Map()) {
  const changed = [...sources.values()].filter(
    (source) => prior.get(source.where) !== chunkFor(source),
  );
  return { text: [BEGIN, ...changed.map(chunkFor), END].join('\n\n'), changed };
}

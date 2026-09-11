// The rules a function file has to satisfy, and the rendering of the tree into
// a migration. Kept apart from the command that runs them (gen-sql-functions.mjs)
// and from the cases that prove they fire (sql-functions-cases.mjs), because
// they are three jobs and AGENTS.md asks for files under ~300 lines split by
// responsibility.
//
// Everything here is a pure function over a map of `repo-relative path →
// contents`, never over the disk, so the cases can hand it a tree that does
// not exist.
export const BEGIN = '-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)';
export const END = '-- END GENERATED: function definitions';

// Deliberately lenient about everything Postgres is lenient about, because
// this is a guard and what it guards against is somebody writing SQL the
// ordinary way: `CREATE OR REPLACE FUNCTION` in caps, a bare `create
// function`, an indented statement, a quoted identifier. Strict matching would
// mean the rule only catches the house style, which is the one form that was
// never the risk.
const NAME = String.raw`"?[A-Za-z_][\w$]*"?(?:\s*\.\s*"?[A-Za-z_][\w$]*"?)*`;
const CREATES = new RegExp(
  String.raw`^[ \t]*create\s+(?:or\s+replace\s+)?function\s+(${NAME})\s*\(`,
  'gim',
);
const DROPS = new RegExp(String.raw`^[ \t]*drop\s+function(?:\s+if\s+exists)?\s`, 'gim');
const NAMES = new RegExp(NAME, 'g');

/**
 * Postgres folds an unquoted identifier to lower case, so `Public.Foo` and
 * `public.foo` are one function. Quoted identifiers keep their case; this
 * folds them too, which could in principle mis-key `"Foo"` — no such name
 * exists here, and mis-keying makes the guard *complain*, never pass.
 */
function normalise(text) {
  return text.replace(/["\s]/g, '').toLowerCase();
}

function createdIn(sql) {
  return [...sql.matchAll(CREATES)].map((match) => normalise(match[1]));
}

/** The parameter list, by matching parentheses — defaults may contain their own. */
function argumentsFrom(sql, open) {
  let depth = 0;
  for (let at = open; at < sql.length; at += 1) {
    if (sql[at] === '(') depth += 1;
    else if (sql[at] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, at);
    }
  }
  return '';
}

/**
 * A parameter list reduced to what identifies the function — as far as a
 * script can honestly go. Comments and default values are dropped, because
 * `create or replace` may add a default without changing the signature, and
 * whitespace and case are folded.
 *
 * It stops there. It does not know that `timestamptz` and `timestamp with time
 * zone` are one type, or that a parameter's *name* is no part of its identity,
 * so two spellings of one signature read here as two signatures. That
 * direction is the safe one — the guard complains rather than excuses — and
 * the message that uses it says as much.
 */
function signatureOf(args) {
  return normalise(args.replace(/--[^\n]*/g, ' ').replace(/\bdefault\b[^,]*/gi, ''));
}

/**
 * Every create and drop, in the order they appear, so a drop cannot excuse a
 * create that comes after it. A single `drop function a(…), b(…)` drops both,
 * so a drop's names are read from its whole statement rather than just the
 * first one.
 *
 * A create also carries its signature, because `create or replace` of the
 * *same* one is a redefinition — which this history is full of — while a
 * different one is an overload. Only the second is ambiguous when a drop
 * arrives.
 */
function operations(sql) {
  const ops = [];
  for (const match of sql.matchAll(CREATES)) {
    const open = match.index + match[0].length - 1;
    ops.push({
      at: match.index,
      name: normalise(match[1]),
      signature: signatureOf(argumentsFrom(sql, open)),
      dropping: false,
    });
  }
  for (const match of sql.matchAll(DROPS)) {
    const statement = sql.slice(match.index + match[0].length).split(';')[0];
    for (const name of statement.match(NAMES) ?? []) {
      ops.push({ at: match.index, name: normalise(name), dropping: true });
    }
  }
  return ops.sort((earlier, later) => earlier.at - later.at);
}

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
 * Nothing may be defined in a migration and left unfiled, or the next ticket
 * adds a function the old way and the tree quietly stops being true.
 *
 * What matters is each function's *last* word: created and later dropped needs
 * no file, but dropped and later created again does. Migrations are read in
 * filename order and each file's statements in the order they appear, so
 * "last" means last.
 */
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

export function analyse(sourceFiles, migrationFiles) {
  const problems = [];
  const sources = new Map();
  for (const [where, raw] of sourceFiles) {
    checkSourceFile(where, raw.trimEnd(), sources, problems);
  }
  checkMigrations(migrationFiles, sources, problems);
  return { problems, sources };
}

export function render(sources) {
  return [BEGIN, ...[...sources.values()].map(({ where, sql }) => `-- ${where}\n${sql}`), END].join(
    '\n\n',
  );
}

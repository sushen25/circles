// How this repository's SQL is read: the shapes a statement can take, and the
// parsers that pull a name, a signature or a generated block's boundaries out
// of one. It knows nothing about what ought to be true — that is
// `sql-functions-rules.mjs`, which imports from here.
//
// Everything is deliberately lenient about what Postgres is lenient about.
// These are used by a guard, and what a guard has to catch is somebody writing
// SQL the ordinary way: `CREATE OR REPLACE FUNCTION` in capitals, a bare
// `create function`, an indented statement, a quoted identifier, a `grant`
// without parentheses. Matching only the house style would leave the rule
// catching the one form that was never the risk — which is this repository's
// most common defect, and the reason these are as loose as they are.

/** The fences around a generated block: `blockSpans` reads them, the generator writes them. */
export const BEGIN = '-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)';

export const END = '-- END GENERATED: function definitions';

export const NAME = String.raw`"?[A-Za-z_][\w$]*"?(?:\s*\.\s*"?[A-Za-z_][\w$]*"?)*`;

export const CREATES = new RegExp(
  String.raw`^[ \t]*create\s+(?:or\s+replace\s+)?function\s+(${NAME})\s*\(`,
  'gim',
);

export const DROPS = new RegExp(String.raw`^[ \t]*drop\s+function(?:\s+if\s+exists)?\s`, 'gim');

/**
 * The other ways to change a function's definition by hand. A file is supposed
 * to hold the body, the comment *and* the grants, and an ACL is the part most
 * likely to be adjusted in a hurry.
 *
 * The parentheses are optional because Postgres makes them optional whenever
 * the name is unambiguous — and every function here is unique by name, because
 * the tree is keyed by name. So `grant execute on function public.f to anon`,
 * the shortest thing a hurried hand types, is always legal here and would
 * always have slipped past a rule that demanded `f(`.
 *
 * This matches the *head* of such a statement; the names are then read from
 * the rest of it, the way a `drop` is, so that a list — `grant … on function
 * a, b to anon`, legal and with no parentheses to separate the names — is read
 * whole rather than stopping at the first. Bare words like `execute` or `anon`
 * come back too and are harmless: a filed function is always `schema.name`, so
 * a word with no dot can never match one.
 */
export const TOUCH_HEADS = new RegExp(
  String.raw`^[ \t]*(?:(?:revoke|grant)\b[^;]*?\bon\s+(?:function|routine|procedure)` +
    String.raw`|alter\s+(?:function|routine|procedure)` +
    String.raw`|comment\s+on\s+(?:function|routine|procedure))\s`,
  'gim',
);

/**
 * The bulk form, which names no function at all and reaches every one of them:
 * `grant execute on all functions in schema public to anon`. It cannot be
 * attributed to a file, so it is reported as itself.
 */
export const BULK_ACL = new RegExp(
  String.raw`^[ \t]*(?:revoke|grant)\b[^;]*?\bon\s+all\s+(?:functions|routines|procedures)\s+in\s+schema\s+(${NAME})`,
  'gim',
);

export const NAMES = new RegExp(NAME, 'g');

/**
 * Postgres folds an unquoted identifier to lower case, so `Public.Foo` and
 * `public.foo` are one function. Quoted identifiers keep their case; this
 * folds them too, which could in principle mis-key `"Foo"` — no such name
 * exists here, and mis-keying makes the guard *complain*, never pass.
 */
export function normalise(text) {
  return text.replace(/["\s]/g, '').toLowerCase();
}

export function createdIn(sql) {
  return [...sql.matchAll(CREATES)].map((match) => normalise(match[1]));
}

/** The parameter list, by matching parentheses — defaults may contain their own. */
export function argumentsFrom(sql, open) {
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

/** The parameters, split on the commas that separate them and not on any other. */
export function parametersOf(list) {
  const parameters = [];
  let depth = 0;
  let current = '';
  for (const character of list) {
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parameters.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim() !== '') parameters.push(current);
  return parameters;
}

/**
 * A parameter list reduced to what identifies the function — as far as a
 * script can honestly go. Comments go, and so does each parameter's default,
 * because `create or replace` may add one without changing the signature. The
 * split is per parameter rather than by regex over the whole list, so a default
 * containing its own comma — `default format('%s,%s', a, b)` — does not leave
 * half of itself behind.
 *
 * It stops there. It does not know that `timestamptz` and `timestamp with time
 * zone` are one type, or that a parameter's *name* is no part of its identity,
 * so two spellings of one signature read here as two signatures. That
 * direction is the safe one — the guard complains rather than excuses — and
 * the message that uses it says as much.
 */
export function signatureOf(args) {
  const plain = args.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  return normalise(
    parametersOf(plain)
      .map((parameter) => parameter.split(/\bdefault\b|=/i)[0])
      .join(','),
  );
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
export function operations(sql) {
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

/** Where each generated block starts and ends, so a create can be placed. */
export function blockSpans(sql) {
  const spans = [];
  let from = 0;
  for (;;) {
    const start = sql.indexOf(BEGIN, from);
    if (start === -1) break;
    const finish = sql.indexOf(END, start);
    if (finish === -1) break;
    spans.push([start, finish + END.length]);
    from = finish + END.length;
  }
  return spans;
}

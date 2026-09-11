// Every rule in `sql-functions-rules.mjs`, shown failing.
//
// A guard nobody has seen fail is a guard nobody knows works, so these run
// inside `pnpm check:functions` rather than beside the unit tests: the gate
// cannot then pass with a broken guard. Each case names the message it expects,
// so a case cannot pass because some unrelated rule happened to fire, and the
// cases without an expectation assert that a clean tree stays quiet.
import { BEGIN, END, analyse, migrationsFor } from './sql-functions-rules.mjs';

/** A minimal well-formed function file, for the cases to break. */
function sample(name = 'public.example', extra = '') {
  return `create or replace function ${name}()
returns integer
language sql
immutable
as $$ select 1 $$;

revoke all on function ${name}() from public;
revoke all on function ${name}() from anon, authenticated;
${extra}`;
}

const FILE = 'supabase/sql/functions/public/example.sql';
const clean = () => new Map([[FILE, sample()]]);

/** A migration that carries a generated block holding exactly these files. */
function generated(...chunks) {
  return [BEGIN, ...chunks, END].join('\n\n');
}

const seam = () => generated(`-- ${FILE}\n${sample()}`);

/** A case whose tree is fine and whose migrations are the point. */
const inMigrations = (label, migrations, expect) => ({
  label,
  files: clean(),
  migrations: new Map(Object.entries(migrations)),
  expect,
});

/** The same, after the tree took over: `0008` is the seam, `0010` the offence. */
const afterSeam = (label, sql, expect) =>
  inMigrations(label, { '0008_seam.sql': seam(), '0010_later.sql': sql }, expect);

/** A case whose migrations are fine and whose tree is the point. */
const inTree = (label, files, expect) => ({ label, files, migrations: new Map(), expect });

const UNFILED = 'has no file';
const BY_HAND = 'by hand, outside the generated block';
const NOT_THE_BODY = 'grants, comment or attributes';

export const CASES = [
  // A file has to describe one function, under its own name, and say who may
  // call it.
  inTree('a clean tree', clean()),
  inTree(
    'two functions in one file',
    new Map([[FILE, `${sample()}\n${sample('public.other')}`]]),
    'found 2',
  ),
  inTree(
    'one function in two files',
    new Map([
      [FILE, sample()],
      ['supabase/sql/functions/public/example_copy.sql', sample()],
    ]),
    'is defined in two files',
  ),
  inTree(
    'a function filed under the wrong name',
    new Map([['supabase/sql/functions/public/wrong.sql', sample()]]),
    'it belongs at',
  ),
  inTree('a function with no schema', new Map([[FILE, sample('example')]]), 'with no schema'),
  inTree(
    'a stripped revoke from public',
    new Map([[FILE, sample().replace(/revoke all on function [^\n]*from public;\n/, '')]]),
    'PUBLIC keeps the execute',
  ),
  inTree(
    'a grant back to PUBLIC',
    new Map([
      [FILE, sample('public.example', 'grant execute on function public.example() to public;')],
    ]),
    'grants execute to PUBLIC',
  ),
  inTree(
    'anon left undecided',
    new Map([[FILE, sample().replace(/revoke all on function [^\n]*from anon[^\n]*\n/, '')]]),
    'anon is neither revoked nor granted',
  ),
  inTree(
    'authenticated left undecided on its own',
    new Map([[FILE, sample().replace('from anon, authenticated;', 'from anon;')]]),
    'authenticated is neither revoked nor granted',
  ),

  // Nothing may be defined in a migration and left unfiled — in any of the
  // spellings Postgres accepts, because those are the ones a hurried hand and
  // most tools produce.
  inMigrations('a clean tree whose function is also in a migration', {
    '0002_x.sql': 'create or replace function public.example()\n',
  }),
  inMigrations(
    'a function defined in a migration but never filed',
    { '0009_new.sql': 'create or replace function public.unfiled(a uuid)\n' },
    UNFILED,
  ),
  inMigrations(
    'the same, shouted — the form most tools emit',
    { '0009_new.sql': 'CREATE OR REPLACE FUNCTION public.unfiled(a uuid)\n' },
    UNFILED,
  ),
  inMigrations(
    'the same, without "or replace"',
    { '0009_new.sql': 'create function public.unfiled(a uuid)\n' },
    UNFILED,
  ),
  inMigrations(
    'the same, indented',
    { '0009_new.sql': '  create or replace function public.unfiled(a uuid)\n' },
    UNFILED,
  ),
  inMigrations(
    'the same, quoted',
    { '0009_new.sql': 'create or replace function "public"."unfiled"(a uuid)\n' },
    UNFILED,
  ),

  // A drop ends it — but only the create it follows.
  inMigrations('unless a later migration drops it', {
    '0009_new.sql': 'create or replace function public.unfiled(a uuid)\n',
    '0010_gone.sql': 'drop function public.unfiled(uuid);\n',
  }),
  inMigrations('or the same migration does', {
    '0009_both.sql':
      'create or replace function public.unfiled(a uuid)\ndrop function public.unfiled(uuid);\n',
  }),
  inMigrations('or one drop statement names it alongside another', {
    '0009_two.sql':
      'create or replace function public.one(a uuid)\ncreate or replace function public.two(a uuid)\n' +
      'drop function public.one(uuid), public.two(uuid);\n',
  }),
  inMigrations(
    'but a drop does not excuse a later create',
    {
      '0009_gone.sql': 'drop function public.unfiled(uuid);\n',
      '0010_back.sql': 'create or replace function public.unfiled(a uuid)\n',
    },
    UNFILED,
  ),
  inMigrations(
    'nor one recreated further down the same migration',
    {
      '0009_churn.sql':
        'drop function public.unfiled(uuid);\ncreate or replace function public.unfiled(a uuid)\n',
    },
    UNFILED,
  ),

  // Two signatures and a drop is ambiguous; one signature written twice is a
  // redefinition, and the history is full of those.
  inMigrations(
    'and a dropped overload does not excuse its surviving sibling',
    {
      '0009_overload.sql':
        'create or replace function public.u(a uuid)\ncreate or replace function public.u(a text)\n' +
        'drop function public.u(text);\n',
    },
    'cannot say which survives',
  ),
  inMigrations('while one signature redefined and then dropped is simply gone', {
    '0009_redefined.sql':
      'create or replace function public.u(a uuid)\ncreate or replace function public.u(\n  a uuid\n)\n' +
      'drop function public.u(uuid);\n',
  }),
  inMigrations('and so is one whose redefinition only added a default', {
    '0009_default.sql':
      'create or replace function public.u(a uuid)\n' +
      'create or replace function public.u(a uuid default gen_random_uuid())\n' +
      'drop function public.u(uuid);\n',
  }),
  inMigrations('even when that default contains its own comma', {
    '0009_comma.sql':
      'create or replace function public.u(a text, b integer)\n' +
      "create or replace function public.u(a text default format('%s,%s', 1, 2), b integer)\n" +
      'drop function public.u(text, integer);\n',
  }),
  inMigrations('or is spelled with = instead of the word default', {
    '0009_equals.sql':
      'create or replace function public.u(a integer)\ncreate or replace function public.u(a integer = 3)\n' +
      'drop function public.u(integer);\n',
  }),
  inMigrations('or the redefinition only added a block comment', {
    '0009_comment.sql':
      'create or replace function public.u(a integer)\ncreate or replace function public.u(a integer /* the one */)\n' +
      'drop function public.u(integer);\n',
  }),

  // Once the tree is the truth, a migration must not quietly disagree with it.
  // This is ADR 0015's promise in its quietest failure: the database runs the
  // hand-written body, the file still matches what the generator wrote, and
  // nothing drifts.
  afterSeam(
    'a filed function redefined by hand after the tree took over',
    'create or replace function public.example()\nreturns integer\n',
    BY_HAND,
  ),
  afterSeam(
    'a grant changed by hand, away from the file that holds it',
    'grant execute on function public.example() to anon;\n',
    NOT_THE_BODY,
  ),
  afterSeam(
    'a grant written without parentheses, which is always legal here',
    'grant execute on function public.example to anon;\n',
    NOT_THE_BODY,
  ),
  afterSeam(
    'an alter that changes what it runs as',
    'alter function public.example() security definer;\n',
    NOT_THE_BODY,
  ),
  afterSeam(
    'a grant over every function in a schema at once',
    'grant execute on all functions in schema public to anon;\n',
    'every function in schema public at once',
  ),
  afterSeam('but the same definition inside a later generated block is the normal way', seam()),
  inMigrations(
    'including when the hand edit is in the newest migration of all',
    {
      '0008_seam.sql': seam(),
      '0009_current.sql': `create or replace function public.example()\nreturns integer\n${generated()}`,
    },
    BY_HAND,
  ),
  inMigrations('and the migrations before the seam are where these definitions came from', {
    '0002_origin.sql': 'create or replace function public.example()\nreturns integer\n',
    '0008_seam.sql': seam(),
  }),
];

/**
 * Claims that are not about a tree at all, and so cannot be a case above.
 *
 * `migrationsFor` is here because getting it wrong was a defect once: the rules
 * were handed every migration *except* the one being written, so the file most
 * likely to receive a hand-written definition was the only one never checked.
 * A case over `analyse` could not have caught it — the selection happened in
 * the command.
 */
const INVARIANTS = [
  {
    label: 'the rules see the migration being written; the comparison does not',
    holds() {
      const files = new Map([
        ['0008_seam.sql', 'seam'],
        ['0009_current.sql', 'current'],
      ]);
      const { checked, earlier } = migrationsFor(files, '0009_current.sql');
      return (
        checked.has('0009_current.sql') &&
        !earlier.has('0009_current.sql') &&
        earlier.has('0008_seam.sql')
      );
    },
  },
];

/** The labels of cases and invariants that did not hold. */
export function selfTest() {
  const unfired = CASES.filter(({ files, migrations, expect }) => {
    const { problems } = analyse(files, migrations);
    if (expect === undefined) return problems.length > 0;
    return !problems.some((problem) => problem.includes(expect));
  }).map(({ label }) => label);

  return [...unfired, ...INVARIANTS.filter(({ holds }) => !holds()).map(({ label }) => label)];
}

export const CLAIMS = CASES.length + INVARIANTS.length;

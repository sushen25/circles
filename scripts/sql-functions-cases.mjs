// Every rule in `sql-functions-rules.mjs`, shown failing.
//
// A guard nobody has seen fail is a guard nobody knows works, so these run
// inside `pnpm check:functions` rather than beside the unit tests: the gate
// cannot then pass with a broken guard. Each case names the message it expects,
// so a case cannot pass because some unrelated rule happened to fire, and the
// cases without an expectation assert that a clean tree stays quiet.
import { analyse } from './sql-functions-rules.mjs';

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

export const CASES = [
  { label: 'a clean tree', files: clean(), migrations: new Map() },
  {
    label: 'a clean tree whose function is also in a migration',
    files: clean(),
    migrations: new Map([['0002_x.sql', 'create or replace function public.example()\n']]),
  },
  {
    label: 'two functions in one file',
    files: new Map([[FILE, `${sample()}\n${sample('public.other')}`]]),
    migrations: new Map(),
    expect: 'found 2',
  },
  {
    label: 'one function in two files',
    files: new Map([
      [FILE, sample()],
      ['supabase/sql/functions/public/example_copy.sql', sample()],
    ]),
    migrations: new Map(),
    expect: 'is defined in two files',
  },
  {
    label: 'a stripped revoke from public',
    files: new Map([[FILE, sample().replace(/revoke all on function [^\n]*from public;\n/, '')]]),
    migrations: new Map(),
    expect: 'PUBLIC keeps the execute',
  },
  {
    label: 'a grant back to PUBLIC',
    files: new Map([
      [FILE, sample('public.example', 'grant execute on function public.example() to public;')],
    ]),
    migrations: new Map(),
    expect: 'grants execute to PUBLIC',
  },
  {
    label: 'anon left undecided',
    files: new Map([
      [FILE, sample().replace(/revoke all on function [^\n]*from anon[^\n]*\n/, '')],
    ]),
    migrations: new Map(),
    expect: 'anon is neither revoked nor granted',
  },
  {
    label: 'authenticated left undecided on its own',
    files: new Map([[FILE, sample().replace('from anon, authenticated;', 'from anon;')]]),
    migrations: new Map(),
    expect: 'authenticated is neither revoked nor granted',
  },
  {
    label: 'a function filed under the wrong name',
    files: new Map([['supabase/sql/functions/public/wrong.sql', sample()]]),
    migrations: new Map(),
    expect: 'it belongs at',
  },
  {
    label: 'a function with no schema',
    files: new Map([[FILE, sample('example')]]),
    migrations: new Map(),
    expect: 'with no schema',
  },
  {
    label: 'a function defined in a migration but never filed',
    files: clean(),
    migrations: new Map([['0009_new.sql', 'create or replace function public.unfiled(a uuid)\n']]),
    expect: 'has no file',
  },
  {
    label: 'the same, shouted — the form most tools emit',
    files: clean(),
    migrations: new Map([['0009_new.sql', 'CREATE OR REPLACE FUNCTION public.unfiled(a uuid)\n']]),
    expect: 'has no file',
  },
  {
    label: 'the same, without "or replace"',
    files: clean(),
    migrations: new Map([['0009_new.sql', 'create function public.unfiled(a uuid)\n']]),
    expect: 'has no file',
  },
  {
    label: 'the same, indented',
    files: clean(),
    migrations: new Map([
      ['0009_new.sql', '  create or replace function public.unfiled(a uuid)\n'],
    ]),
    expect: 'has no file',
  },
  {
    label: 'the same, quoted',
    files: clean(),
    migrations: new Map([
      ['0009_new.sql', 'create or replace function "public"."unfiled"(a uuid)\n'],
    ]),
    expect: 'has no file',
  },
  {
    label: 'unless a later migration drops it',
    files: clean(),
    migrations: new Map([
      ['0009_new.sql', 'create or replace function public.unfiled(a uuid)\n'],
      ['0010_gone.sql', 'drop function public.unfiled(uuid);\n'],
    ]),
  },
  {
    label: 'or the same migration does',
    files: clean(),
    migrations: new Map([
      [
        '0009_both.sql',
        'create or replace function public.unfiled(a uuid)\ndrop function public.unfiled(uuid);\n',
      ],
    ]),
  },
  {
    label: 'or one drop statement names it alongside another',
    files: clean(),
    migrations: new Map([
      [
        '0009_two.sql',
        'create or replace function public.one(a uuid)\ncreate or replace function public.two(a uuid)\n' +
          'drop function public.one(uuid), public.two(uuid);\n',
      ],
    ]),
  },
  {
    label: 'but a drop does not excuse a later create',
    files: clean(),
    migrations: new Map([
      ['0009_gone.sql', 'drop function public.unfiled(uuid);\n'],
      ['0010_back.sql', 'create or replace function public.unfiled(a uuid)\n'],
    ]),
    expect: 'has no file',
  },
  {
    label: 'nor one recreated further down the same migration',
    files: clean(),
    migrations: new Map([
      [
        '0009_churn.sql',
        'drop function public.unfiled(uuid);\ncreate or replace function public.unfiled(a uuid)\n',
      ],
    ]),
    expect: 'has no file',
  },
  {
    label: 'and a dropped overload does not excuse its surviving sibling',
    files: clean(),
    migrations: new Map([
      [
        '0009_overload.sql',
        'create or replace function public.u(a uuid)\ncreate or replace function public.u(a text)\n' +
          'drop function public.u(text);\n',
      ],
    ]),
    expect: 'cannot say which survives',
  },
  {
    // The real history is full of these: transition_plan was `create or
    // replace`d three times with one signature. Dropping it is unambiguous,
    // and the guard must not ask for a survivor that cannot exist.
    label: 'while one signature redefined and then dropped is simply gone',
    files: clean(),
    migrations: new Map([
      [
        '0009_redefined.sql',
        'create or replace function public.u(a uuid)\ncreate or replace function public.u(\n  a uuid\n)\n' +
          'drop function public.u(uuid);\n',
      ],
    ]),
  },
  {
    // `create or replace` may add a default without changing the signature.
    label: 'and so is one whose redefinition only added a default',
    files: clean(),
    migrations: new Map([
      [
        '0009_default.sql',
        'create or replace function public.u(a uuid)\n' +
          'create or replace function public.u(a uuid default gen_random_uuid())\n' +
          'drop function public.u(uuid);\n',
      ],
    ]),
  },
  {
    // A default may contain a comma of its own; stripping defaults with a regex
    // over the whole list left `1, 2)` behind, and it read as a second signature.
    label: 'even when that default contains its own comma',
    files: clean(),
    migrations: new Map([
      [
        '0009_comma.sql',
        'create or replace function public.u(a text, b integer)\n' +
          "create or replace function public.u(a text default format('%s,%s', 1, 2), b integer)\n" +
          'drop function public.u(text, integer);\n',
      ],
    ]),
  },
  {
    label: 'or is spelled with = instead of the word default',
    files: clean(),
    migrations: new Map([
      [
        '0009_equals.sql',
        'create or replace function public.u(a integer)\n' +
          'create or replace function public.u(a integer = 3)\n' +
          'drop function public.u(integer);\n',
      ],
    ]),
  },
  {
    label: 'or the redefinition only added a block comment',
    files: clean(),
    migrations: new Map([
      [
        '0009_comment.sql',
        'create or replace function public.u(a integer)\n' +
          'create or replace function public.u(a integer /* the one */)\n' +
          'drop function public.u(integer);\n',
      ],
    ]),
  },
];

/** The labels of cases whose rule did not fire as intended. */
export function selfTest() {
  return CASES.filter(({ files, migrations, expect }) => {
    const { problems } = analyse(files, migrations);
    if (expect === undefined) return problems.length > 0;
    return !problems.some((problem) => problem.includes(expect));
  }).map(({ label }) => label);
}

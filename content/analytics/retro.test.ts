import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, parseFortnight, parseTable, pickFortnight, retro, splitRow } from './retro.ts';
import { buildScorecard } from './scorecard.ts';
import { NOW, inputs } from './scorecard.fixture.ts';

const EXPERIMENTS = `# Experiments

Some prose.

| Fortnight | Family | Shape | Hypothesis | Pieces | Views (TikTok) | Saves+shares /1k | Circles made | Plans shared | Result | Next |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-20 → 11-02 | pm | quote-led | "It's always you" gets tagged | | | | | | | |
| 2026-10-20 → 11-02 | skit | skit (demo-first as the control) | story beats demo | | | | | | | |
| 2026-11-03 → 11-16 | skit | skit | a second look | 9 | | | | | supported | keep it |
| 2026-11-17 → 11-30 | skit | skit | a third | | | | | | | |

After the table.
`;

const run = (fortnight?: string, today = '2026-11-18') => {
  const i = inputs();
  return retro({ experiments: EXPERIMENTS, card: buildScorecard(i, NOW), features: i.features, ledger: i.ledger, today, fortnight });
};

test('a fortnight cell reads with or without the end year, across new year too', () => {
  assert.deepEqual(parseFortnight('2026-10-20 → 11-02'), { start: '2026-10-20', end: '2026-11-02' });
  assert.deepEqual(parseFortnight('2026-12-22 → 01-04'), { start: '2026-12-22', end: '2027-01-04' });
  assert.deepEqual(parseFortnight('2026-12-22 → 2027-01-04'), { start: '2026-12-22', end: '2027-01-04' });
  assert.equal(parseFortnight('next fortnight'), undefined);
  assert.equal(parseFortnight('~~2026-10-20 → 11-02~~ (dropped)'), undefined);
  assert.equal(parseFortnight('2026-10-20 → 10-19'), undefined);
  assert.equal(parseFortnight('2026-10-20 → 2026-11-2'), undefined);
});

test('the default fortnight is the latest that has ended', () => {
  const t = parseTable(EXPERIMENTS);
  assert.equal(t.rows.length, 4);
  assert.equal(pickFortnight(t, '2026-11-18').start, '2026-11-03');
  assert.equal(pickFortnight(t, '2026-11-03').start, '2026-10-20');
  // nothing ended: the running fortnight is named, never filled by default
  assert.deepEqual(pickFortnight(t, '2026-10-25'), { why: 'no fortnight has ended by 2026-10-25; 2026-10-20 is still running (--fortnight 2026-10-20 fills it early)' });
  assert.deepEqual(pickFortnight(t, '2026-10-01'), { why: 'no fortnight has ended by 2026-10-01' });
  assert.equal(pickFortnight(t, '2026-10-25', '2026-10-20').start, '2026-10-20');
  assert.equal(pickFortnight(t, '2026-11-18', '2026-10-21').start, undefined);
});

test('the number cells are filled per row, by family and first-post day, with their n', () => {
  const r = run('2026-10-20');
  assert.deepEqual(r.rows, [
    '| 2026-10-20 → 11-02 | pm | quote-led | "It\'s always you" gets tagged | 3 | 2000 (n=1) | ig 35 (n=3), tt 15 (n=1) |  |  |  |  |',
    '| 2026-10-20 → 11-02 | skit | skit (demo-first as the control) | story beats demo | 0 |  |  |  |  |  |  |',
  ]);
});

test('Result and Next are never touched; only the fortnight\'s rows change in the file', () => {
  const r = run();
  assert.equal(r.start, '2026-11-03');
  assert.deepEqual(r.rows, ['| 2026-11-03 → 11-16 | skit | skit | a second look | 2 |  | ig 11 (n=2) |  |  | supported | keep it |']);
  const before = EXPERIMENTS.split('\n');
  const after = r.updated.split('\n');
  assert.equal(after.length, before.length);
  assert.deepEqual(after.filter((l, i) => l !== before[i]), r.rows);
});

test('a family with pieces none of which is a week old reads too early, never a guess', () => {
  const i = inputs();
  const card = buildScorecard({ ...i, posts: i.posts.filter((p) => p.age_days < 7), hand: [] }, NOW);
  const r = retro({ experiments: EXPERIMENTS, card, features: i.features, ledger: i.ledger, today: '2026-11-18', fortnight: '2026-10-20' });
  assert.match(r.rows[0], /\| 3 \|  \| too early \|/);
});

test('day 30 is due at the last retro before it, for the families live that fortnight, and ranks nothing under three', () => {
  // the first retro (3 Nov) is day 15; the next (17 Nov) is day 29, the last before day 30 on 18 Nov
  assert.deepEqual(run('2026-10-20').day30, []);
  const d = run('2026-11-03').day30;
  assert.equal(d[0], 'Day 30 before the next retro (skit 2026-11-18). Day-7 lift by family:');
  assert.equal(d[1], '- skit: too early to rank (n=2, needs 3)');
  // pm has no row in that fortnight: a family already dropped is not listed again
  assert.equal(d.length, 2);
});

test('a row whose cells do not line up with the header is refused, and nothing is written', () => {
  const bad = EXPERIMENTS.replace('| 2026-11-03 → 11-16 | skit | skit | a second look | 9 | | | | | supported | keep it |', '| 2026-11-03 → 11-16 | skit | skit | a second look | 9 | | | | | supported | keep it | extra note |');
  const i = inputs();
  assert.throws(() => retro({ experiments: bad, card: buildScorecard(i, NOW), features: i.features, ledger: i.ledger, today: '2026-11-18' }), /line 9 has 12 cells where the header has 11/);
});

test('a pipe escaped or inside a code span stays in its cell, and Result and Next survive the write', () => {
  assert.deepEqual(splitRow('| a \\| b | `x | y` | c |'), ['a \\| b', '`x | y`', 'c']);
  const piped = EXPERIMENTS.replace('| a second look |', '| a \\| b hook, `p | q` |');
  const i = inputs();
  const r = retro({ experiments: piped, card: buildScorecard(i, NOW), features: i.features, ledger: i.ledger, today: '2026-11-18' });
  assert.equal(r.rows[0], '| 2026-11-03 → 11-16 | skit | skit | a \\| b hook, `p | q` | 2 |  | ig 11 (n=2) |  |  | supported | keep it |');
});

test('a bold family cell is the same family, and a CRLF file stays CRLF', () => {
  const i = inputs();
  const md = EXPERIMENTS.replace('| 2026-10-20 → 11-02 | pm |', '| 2026-10-20 → 11-02 | **pm** |').replace(/\n/g, '\r\n');
  const r = retro({ experiments: md, card: buildScorecard(i, NOW), features: i.features, ledger: i.ledger, today: '2026-11-18', fortnight: '2026-10-20' });
  assert.match(r.rows[0], /\| \*\*pm\*\* \| quote-led \| .* \| 3 \|/);
  assert.equal(r.updated.split('\r\n').length, md.split('\r\n').length);
  assert.doesNotMatch(r.updated.replace(/\r\n/g, ''), /\n/);
});

test('pieces seven days old only on a platform ranked on another rate read "not measured", not "too early"', () => {
  const i = inputs();
  const card = buildScorecard({ ...i, posts: i.posts.filter((p) => p.platform === 'bluesky'), hand: [] }, NOW);
  const r = retro({ experiments: EXPERIMENTS, card, features: i.features, ledger: i.ledger, today: '2026-11-18', fortnight: '2026-10-20' });
  assert.match(r.rows[0], /\| 3 \|  \| not measured \|/);
});

test('flags: put back when npm swallowed them, refused when a value is missing or unknown', () => {
  assert.deepEqual(parseArgs(['--fortnight', '2026-10-20', '--write'], {}), { fortnight: '2026-10-20', write: true });
  assert.deepEqual(parseArgs([], { npm_config_write: 'true', npm_config_fortnight: '2026-10-20' }), {
    fortnight: '2026-10-20',
    write: true,
    note: 'note  put -- after the script name; read --fortnight, --write from npm',
  });
  assert.throws(() => parseArgs(['--write', '--fortnight'], {}), /--fortnight needs the day a row starts/);
  assert.throws(() => parseArgs(['--fortnight', '--write'], {}), /--fortnight needs the day a row starts/);
  assert.throws(() => parseArgs([], { npm_config_fortnight: 'true' }), /--fortnight needs the day a row starts/);
  assert.throws(() => parseArgs(['--wirte'], {}), /not an option: --wirte/);
});

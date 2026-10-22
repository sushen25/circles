import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFortnight, parseTable, pickFortnight, retro } from './retro.ts';
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
});

test('the default fortnight is the latest that has ended', () => {
  const t = parseTable(EXPERIMENTS);
  assert.equal(t.rows.length, 4);
  assert.equal(pickFortnight(t, '2026-11-18'), '2026-11-03');
  assert.equal(pickFortnight(t, '2026-10-25'), '2026-10-20');
  assert.equal(pickFortnight(t, '2026-10-01'), undefined);
  assert.equal(pickFortnight(t, '2026-11-18', '2026-10-20'), '2026-10-20');
  assert.equal(pickFortnight(t, '2026-11-18', '2026-10-21'), undefined);
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

test('day 30 lists the families past it with their day-7 lift and n, and ranks nothing under three', () => {
  assert.deepEqual(run('2026-11-03').day30, []);
  const d = run('2026-11-17', '2026-12-01').day30;
  assert.match(d[0], /^Day 30 or past it by 2026-11-30 \(first row: pm 2026-10-20, skit 2026-10-20\)/);
  assert.match(d[1], /^- pm: median lift [\d.]+ \(n=3\)$/);
  assert.equal(d[2], '- skit: too early to rank (n=2, needs 3)');
});

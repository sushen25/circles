/**
 * `npm run hand` against a temp file: the row shape, the number rule, the
 * points rule, and the slug warning. Nothing under analytics/ is touched.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { QueueItem } from '../lib/queue.ts';
import { parseArgs, parsePoints, run, type Deps } from './hand.ts';
import type { HandRow } from './metrics.ts';

const NOW = new Date('2026-10-22T10:00:00.000Z');

function harness(known: string[] = ['never-lead-anywhere'], env: Deps['env'] = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hand-test-'));
  const path = join(dir, 'nested', 'hand.jsonl');
  const out: string[] = [];
  const err: string[] = [];
  const deps: Partial<Deps> = {
    path,
    findItem: (slug) => (known.includes(slug) ? ({ fm: { slug } } as QueueItem) : undefined),
    now: () => NOW,
    log: (l) => out.push(l),
    error: (l) => err.push(l),
    // what npm left behind: nothing, unless a test says so, whatever process.env holds
    env,
  };
  const rows = (): HandRow[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { deps, out, err, rows, path };
}

test('parseArgs: numbers, flags, and every reason a call is wrong', () => {
  const ok = parseArgs(['tiktok', 'slug', 'views=1,240', 'saves=18', 'watch_pct=42.5', 'skip_pct=0']);
  assert.deepEqual(ok, { platform: 'tiktok', slug: 'slug', metrics: { views: 1240, saves: 18, watch_pct: 42.5, skip_pct: 0 }, date: undefined, by: 'hand', screen: undefined, captured_at: undefined, points: undefined });
  assert.match(parseArgs(['tiktok', 'slug', 'views=lots']) as string, /views=lots: "lots" is not a number/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=']) as string, /not a number/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=Infinity']) as string, /not a number/);
  // digits only, as an app shows a count: no hex, no sign, no exponent, no dangling point
  assert.match(parseArgs(['tiktok', 'slug', 'views=0x10']) as string, /views=0x10: "0x10" is not a number/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=-5']) as string, /not a number/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=1e3']) as string, /not a number/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=42.']) as string, /not a number/);
  assert.match(parseArgs(['tiktok', 'slug']) as string, /nothing to record/);
  assert.match(parseArgs(['tiktok', 'views=1']) as string, /expected <platform> <slug>/);
  assert.match(parseArgs(['myspace', 'slug', 'views=1']) as string, /not a platform/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=1', '--date', '22/10/2026']) as string, /not YYYY-MM-DD/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=1', '--date', '2026-13-40']) as string, /not a date/);
  // a day that does not exist rolls over in Date, so it fails the round trip
  assert.match(parseArgs(['tiktok', 'slug', 'views=1', '--date', '2026-02-30']) as string, /--date "2026-02-30" is not a date/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=1', '--date', '2026-04-31']) as string, /not a date/);
  assert.equal((parseArgs(['tiktok', 'slug', 'views=1', '--date', '2026-02-28']) as { date?: string }).date, '2026-02-28');
  assert.equal((parseArgs(['tiktok', 'slug', 'views=1', '--date', '2028-02-29']) as { date?: string }).date, '2028-02-29', 'a leap day');
  assert.match(parseArgs(['tiktok', 'slug', 'views=1', '--by', 'robot']) as string, /--by "robot"/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=1', '--captured-at', 'noon']) as string, /not a date/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=1', '--screen']) as string, /needs a value/);
  assert.match(parseArgs(['tiktok', 'slug', 'views=1', '--loud']) as string, /unknown flag/);
});

test('parsePoints: arrays of numbers and objects of numbers, nothing else', () => {
  assert.deepEqual(parsePoints('{"retention":[100,80,60],"sources":{"for_you":71.2,"profile":12}}'), {
    retention: [100, 80, 60],
    sources: { for_you: 71.2, profile: 12 },
  });
  assert.match(parsePoints('not json') as string, /not JSON/);
  assert.match(parsePoints('[1,2]') as string, /must be a JSON object/);
  assert.match(parsePoints('{"retention":[100,"80"]}') as string, /"retention" has a value that is not a finite number/);
  assert.match(parsePoints('{"sources":{"a":null}}') as string, /"sources" has a value/);
  assert.match(parsePoints('{"n":5}') as string, /"n" must be an array or an object/);
});

test('appends a HandRow with today (UTC) and now, and prints it', async () => {
  const h = harness();
  assert.equal(await run(['tiktok', 'never-lead-anywhere', 'views=1240', 'saves=18', 'shares=9'], h.deps), 0);
  const rows = h.rows();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    date: '2026-10-22',
    at: '2026-10-22T10:00:00.000Z',
    slug: 'never-lead-anywhere',
    platform: 'tiktok',
    metrics: { views: 1240, saves: 18, shares: 9 },
    by: 'hand',
  });
  assert.match(h.out.join('\n'), /"metrics":\{"views":1240,"saves":18,"shares":9\}/);
  assert.equal(h.err.length, 0);
});

test('a transcribed screen carries by, screen, captured_at and points; --date sets the day', async () => {
  const h = harness();
  const code = await run(
    [
      'instagram',
      'never-lead-anywhere',
      'views=3100',
      '--date',
      '2026-10-21',
      '--by',
      'transcribed',
      '--screen',
      'retention',
      '--captured-at',
      '2026-10-21T20:15:00+11:00',
      '--points',
      '{"retention":[100,91,80,72,66,60,55,51,48,45,41]}',
    ],
    h.deps,
  );
  assert.equal(code, 0);
  const [row] = h.rows();
  assert.equal(row.date, '2026-10-21');
  assert.equal(row.by, 'transcribed');
  assert.equal(row.screen, 'retention');
  assert.equal(row.captured_at, '2026-10-21T09:15:00.000Z');
  assert.deepEqual(row.points, { retention: [100, 91, 80, 72, 66, 60, 55, 51, 48, 45, 41] });
});

test('points alone are enough; a key that is not a common name gets a note', async () => {
  const h = harness();
  assert.equal(await run(['instagram', 'never-lead-anywhere', '--points', '{"sources":{"reels":70,"profile":30}}'], h.deps), 0);
  assert.deepEqual(h.rows()[0].metrics, {});
  assert.equal(await run(['tiktok', 'never-lead-anywhere', 'view=5'], h.deps), 0);
  assert.match(h.out.join('\n'), /not a common name in metrics.ts.*: view$/m);
  assert.equal(h.rows().length, 2);
});

test('a bad number exits 2 naming it and writes nothing', async () => {
  const h = harness();
  assert.equal(await run(['tiktok', 'never-lead-anywhere', 'views=1240', 'saves=eighteen'], h.deps), 2);
  assert.match(h.err.join('\n'), /saves=eighteen: "eighteen" is not a number/);
  assert.match(h.err.join('\n'), /usage: npm run hand/);
  assert.equal(existsSync(h.path), false);
});

test('bad points exit 2 and write nothing', async () => {
  const h = harness();
  assert.equal(await run(['tiktok', 'never-lead-anywhere', 'views=1', '--points', '{"a":"b"}'], h.deps), 2);
  assert.equal(existsSync(h.path), false);
});

test('a slug with no file is a warning, not an error; the row still lands', async () => {
  const h = harness([]);
  assert.equal(await run(['tiktok', 'not-yet-claimed', 'views=12'], h.deps), 0);
  assert.match(h.out.join('\n'), /warn {2}no queue or published file has slug "not-yet-claimed"/);
  assert.match(h.out.join('\n'), /claim the post with npm run posted -- tiktok not-yet-claimed <url-or-id> when it exists/);
  assert.equal(h.rows()[0].slug, 'not-yet-claimed');
  assert.equal(h.err.length, 0);
});

test('flags npm swallowed are read back from its environment, with one note naming them', async () => {
  // `npm run hand instagram slug views=1 --by=transcribed --screen=retention --captured-at=… --date=… --points=…`, no --
  const h = harness(['never-lead-anywhere'], {
    npm_config_by: 'transcribed',
    npm_config_screen: 'retention',
    npm_config_captured_at: '2026-10-21T20:15:00+11:00',
    npm_config_date: '2026-10-21',
    npm_config_points: '{"retention":[100,80]}',
  });
  assert.equal(await run(['instagram', 'never-lead-anywhere', 'views=3100'], h.deps), 0);
  const [row] = h.rows();
  assert.equal(row.by, 'transcribed');
  assert.equal(row.screen, 'retention');
  assert.equal(row.captured_at, '2026-10-21T09:15:00.000Z');
  assert.equal(row.date, '2026-10-21');
  assert.deepEqual(row.points, { retention: [100, 80] });
  assert.equal(h.out.filter((l) => l === 'note  put -- after the script name; read --date, --by, --screen, --captured-at, --points from npm').length, 1);

  // `--date 2026-10-21` without the --: npm keeps --date as 'true' and the day lands among the arguments, which is a wrong call
  const stray = harness(['never-lead-anywhere'], { npm_config_date: 'true' });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', 'views=1', '2026-10-21'], stray.deps), 2);
  assert.ok(stray.out.includes('note  put -- after the script name; read --date from npm'));
  assert.match(stray.err.join('\n'), /--date needs a value/);
  assert.equal(existsSync(stray.path), false);

  // `--by transcribed` (or --by=transcribed): npm today expands --by to its own boolean --bypass-2fa and drops the value among the arguments
  const by = harness(['never-lead-anywhere'], { npm_config_bypass_2fa: 'true' });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', 'views=1', 'transcribed'], by.deps), 2);
  assert.ok(by.out.includes('note  put -- after the script name; read --by from npm'), by.out.join('\n'));
  assert.match(by.err.join('\n'), /--by needs a value/);
  assert.equal(existsSync(by.path), false);

  // nothing swallowed, nothing noted
  const plain = harness();
  assert.equal(await run(['tiktok', 'never-lead-anywhere', 'views=1'], plain.deps), 0);
  assert.ok(!plain.out.some((l) => l.startsWith('note  put --')));
});

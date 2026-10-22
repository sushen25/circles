import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atAge, buildScorecard, first48, readReplies } from './scorecard.ts';
import { renderScorecard } from './scorecard-md.ts';
import { MIN_N, aggregate, controlLive } from './aggregates.ts';
import type { PieceScore } from './scorecard.ts';
import { NOW, inputs } from './scorecard.fixture.ts';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const card = () => buildScorecard(inputs(), NOW);
const piece = (slug: string, platform: string) => card().pieces.find((p) => p.slug === slug && p.platform === platform)!;

test('a snapshot is the first at or after the age, and never one from past the next age', () => {
  const rows = [{ age_days: 0.6 }, { age_days: 1.4 }, { age_days: 3.2 }, { age_days: 7.9 }];
  assert.equal(atAge(rows, 1)?.age_days, 1.4);
  assert.equal(atAge(rows, 7)?.age_days, 7.9);
  assert.equal(atAge([{ age_days: 9 }], 1), undefined);
  assert.equal(atAge([{ age_days: 20 }], 14)?.age_days, 20);
  assert.equal(atAge([{ age_days: 21 }], 14), undefined);
});

test('a missed night costs precision, not the row', () => {
  assert.equal(piece('pm-two', 'instagram').ages['7']?.age_days, 7.9);
});

test('lift is the day-7 rate over the platform median, platform by platform', () => {
  const c = card();
  assert.deepEqual(c.medians.instagram, { rate: 'saves_shares_per_k', median: 21, n: 6 });
  assert.deepEqual(c.medians.bluesky, { rate: 'engagement', median: 4.5, n: 4 });
  assert.equal(piece('pm-two', 'instagram').lift, 1.9);
  assert.equal(piece('pm-two', 'bluesky').lift, 1.33);
  assert.equal(piece('rhythm-one', 'instagram').lift, 0.24);
});

test('hand numbers stand in where the pull has none, aged from the posted ledger row and marked', () => {
  const t = piece('pm-one', 'tiktok');
  assert.equal(t.ages['7']?.source, 'hand');
  assert.equal(t.ages['7']?.rates.saves_shares_per_k, 15);
  // a transcribed screen on a platform the pull reads is shown beside it, never scored
  const ig = piece('pm-one', 'instagram');
  assert.equal(ig.ages['7']?.source, 'pull');
  assert.deepEqual(ig.screens[0].retention, [
    { tenth: '0.0', pct: 100, slide: 1 },
    { tenth: '0.5', pct: 40, slide: 4 },
    { tenth: '1.0', pct: 12, slide: 7 },
  ]);
  assert.equal(ig.screens[0].sources?.reels_tab, 57.1);
});

test('nothing under n=3 is ranked; every group carries its n, and the small ones are too early', () => {
  const c = card();
  for (const g of c.groups) assert.equal(g.ranked, g.n >= MIN_N, `${g.dimension} ${g.value}`);
  const pm = c.groups.find((g) => g.dimension === 'family' && g.value === 'pm')!;
  assert.equal(pm.n, 3);
  assert.equal(pm.ranked, true);
  assert.ok(pm.median_lift! > 1.2);
  const skit = c.groups.find((g) => g.dimension === 'family' && g.value === 'skit')!;
  assert.equal(skit.ranked, false);
  assert.ok(c.too_early.includes('family skit (n=2)'));
  assert.ok(c.too_early.includes('family rhythm (n=1)'));
});

test('a split is reportable only with three a side and a gap wider than the spread', () => {
  const c = card();
  const num = c.splits.find((s) => s.name === 'hook with a number')!;
  assert.equal(num.yes.n, 3);
  assert.equal(num.no.n, 3);
  assert.equal(num.reportable, true);
  const aside = c.splits.find((s) => s.name === 'a caption aside on a slide')!;
  assert.equal(aside.yes.n, 0);
  assert.equal(aside.reportable, false);
});

test('the control arm is reported by name while its experiments row is live', () => {
  const c = card();
  assert.equal(c.control?.demo_first.n, 1);
  assert.equal(c.control?.story_first.n, 5);
  assert.equal(c.control?.ranked, false);
  assert.equal(controlLive('| a | Result |\n|---|---|\n| demo-first | refuted |'), false);
  assert.equal(buildScorecard({ ...inputs(), experiments: '' }, NOW).control, undefined);
});

test('the first 48 hours: views at fixed hours and where the curve bent', () => {
  assert.deepEqual(piece('rhythm-one', 'instagram').first48, { views: { h2: 100, h6: 300, h12: 330, h24: 390, h48: 510 }, bent_at_h: 8 });
  assert.equal(first48([]), undefined);
});

test('replies that quote the hook are counted', () => {
  const p = piece('pm-one', 'bluesky');
  assert.equal(p.replies, 2);
  assert.equal(p.hook_quotes, 1);
});

test('replies are read from the inbox sections, done/ included', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-'));
  mkdirSync(join(dir, 'done'));
  writeFileSync(join(dir, '2026-11-01-replies.md'), '# Replies, 2026-11-01\n\n## pm-one · bluesky\n\n> first\n> line two\n\n> second\n');
  writeFileSync(join(dir, 'done', '2026-10-30-replies.md'), '# Replies\n\n## pm-two · threads\n\n> third\n');
  assert.deepEqual(readReplies(dir), [
    { slug: 'pm-one', platform: 'bluesky', text: 'first\nline two' },
    { slug: 'pm-one', platform: 'bluesky', text: 'second' },
    { slug: 'pm-two', platform: 'threads', text: 'third' },
  ]);
});

test('scorecard.md: dated in Melbourne, ranked rows with n, the like rate never ranked, short enough to read', () => {
  const md = renderScorecard(card());
  assert.match(md, /on 2026-11-18 from/);
  const ranked = md.split('## Ranked')[1].split('\n## ')[0];
  assert.match(ranked, /\| family \| pm \| [\d.]+ \| 3 \|/);
  assert.doesNotMatch(ranked, /skit \| [\d.]+ \| 2/);
  assert.doesNotMatch(ranked, /like/i);
  const early = md.split('## Too early\n\n')[1];
  assert.match(early, /- family skit \(n=2\)/);
  assert.match(early, /- hook is a quote \(n=2 vs 4\)/);
  assert.doesNotMatch(early, /vs 0|n=0 vs/);
  assert.match(md, /\| a skip slide \| – \(n=0\) \| [\d.]+ \(n=6\) \| no contrast yet \|/);
  assert.doesNotMatch(ranked, /\| platform \|/);
  assert.match(md, /pm-one \| tiktok \| saves\+shares \/1k views \| – \| – \| 15† \| – \| 15† at 7\.5 d \| – \| – \| – \|/);
  assert.match(md, /instagram, 2026-11-17: followers 42 · reach 300 · reach by follow type: follower 60, non_follower 240/);
  assert.ok(md.split('\n').length < 120, `${md.split('\n').length} lines`);
});

test('an empty repo still renders a scorecard that says so', () => {
  const md = renderScorecard(buildScorecard({ ...inputs(), posts: [], series: [], hand: [], account: [], features: [], replies: [], experiments: '' }, NOW));
  assert.match(md, /No piece is seven days old/);
  assert.match(md, /No published piece has a row yet/);
});

test('a platform with fewer than three pieces at day 7 gives no lift, and its lone piece counts in no group', () => {
  const c = card();
  assert.deepEqual(c.medians.tiktok, { rate: 'saves_shares_per_k', median: 15, n: 1 });
  assert.equal(piece('pm-one', 'tiktok').lift, undefined);
  assert.equal(c.groups.find((g) => g.dimension === 'family' && g.value === 'pm')!.by_platform.tiktok, undefined);
});

test('a transcribed screen in the same window never hides the typed row that carries the rate', () => {
  const i = inputs();
  const typed = i.hand[0];
  i.hand.push({ ...typed, at: new Date(Date.parse(typed.at) - 0.4 * 86_400_000).toISOString(), metrics: { watch_avg_s: 9 }, by: 'transcribed', screen: 'overview' });
  const t = buildScorecard(i, NOW).pieces.find((p) => p.slug === 'pm-one' && p.platform === 'tiktok')!;
  assert.equal(t.ages['7']?.source, 'hand');
  assert.equal(t.day7, 15);
});

test('each piece counts once in a group: one piece on many platforms cannot carry its median', () => {
  const p = (slug: string, platform: string, lift: number) => ({ slug, platform, family: 'pm', ages: {}, headline: 'saves_shares_per_k', lift, screens: [], replies: 0, hook_quotes: 0 }) as unknown as PieceScore;
  const a = aggregate([p('a', 'instagram', 2), p('a', 'bluesky', 2), p('a', 'threads', 2), p('a', 'youtube', 2), p('b', 'instagram', 0.5), p('c', 'instagram', 0.5)], new Map(), '');
  const pm = a.groups.find((g) => g.dimension === 'family')!;
  assert.equal(pm.n, 3);
  assert.equal(pm.median_lift, 0.5);
});

test('"48 h" is the last series row before the pull stops at 48 hours', () => {
  const i = inputs();
  i.series = i.series.filter((r) => r.age_hours < 48);
  i.series.push({ ...i.series[0], age_hours: 47.5, metrics: { views: 505 } });
  const f = buildScorecard(i, NOW).pieces.find((p) => p.slug === 'rhythm-one' && p.platform === 'instagram')!.first48!;
  assert.equal(f.views.h48, 505);
  assert.equal(f.views.h24, 390);
});

test('the funnel by tag joins to the piece it came from, by the tag the link carries, latest night wins', () => {
  const row = (date: string, from: string, circles: number) => ({ date, at: `${date}T16:15:00.000Z`, from, circles, plans_shared: circles, answered: 0, confirmed: 0, raw: {} });
  const card = buildScorecard(
    {
      ...inputs(),
      funnel: [
        row('2026-11-16', 'bs-pm-one', 1),
        row('2026-11-17', 'bs-pm-one', 3),
        row('2026-11-17', 'ig-pm-one', 2),
        row('2026-11-17', 'bs-unrelated', 9),
        { date: '2026-11-17', at: '2026-11-17T16:15:00.000Z', stalled: [{ week: '2026-11-16', cohort: 'external', source: 'content', state: 'not_shared', circles: 1, oldest_hours: 30, median_hours: 30 }] },
      ],
    },
    NOW,
  );
  const piece = (slug: string, platform: string) => card.pieces.find((p) => p.slug === slug && p.platform === platform);
  assert.deepEqual(piece('pm-one', 'bluesky')?.funnel, { as_of: '2026-11-17', circles: 3, plans_shared: 3, answered: 0, confirmed: 0 });
  assert.deepEqual(piece('pm-one', 'instagram')?.funnel, { as_of: '2026-11-17', circles: 2, plans_shared: 2, answered: 0, confirmed: 0 });
  assert.equal(piece('pm-two', 'instagram')?.funnel, undefined, 'a piece with no tag row has no funnel');
  assert.equal(card.stalled?.groups.length, 1);
  assert.match(renderScorecard(card), /## After the tap[\s\S]*\| pm-one \| bluesky \| 3 \| 3 \| 0 \| 0 \| 2026-11-17 \|/);
  assert.equal(buildScorecard(inputs(), NOW).stalled, undefined, 'and with no export read, nothing is shown');
});

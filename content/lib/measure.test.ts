import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseQueueFile } from './queue.ts';
import { measure, melbourne, melbourneDate, readTiming, sameFeatures, setTiming, timingOf, token } from './measure.ts';

const FILE = `---
slug: test-piece
date: 2026-11-02
family: pm
hook: "It's always you, 3 weeks in a row"
archetype: count
shape: quote-led
status: approved
platforms: [instagram, bluesky, youtube]
publish_at: 2026-11-02T18:00:00+11:00
publish_window_minutes: 90
media: slideshow
published:
  instagram: "18395365036204751"
---

\`\`\`json
{
  "hook": "It's always you",
  "me": "Sam",
  "slides": [
    { "type": "quote", "text": "it's always you", "source": "r/AskAnAustralian" },
    { "type": "chat", "title": "Uni lot", "when": "Mon 8 pm", "pace": "slow", "caption": "again.",
      "messages": [ { "from": "Sam", "text": "dinner?" }, { "from": "Ali", "text": "yes" } ] },
    { "type": "skip", "line": "Three weeks later" },
    { "type": "poll", "title": "Uni lot", "asked": "Sam", "question": "Which night", "options": [], "after": [ { "from": "Kit", "text": "any" } ] },
    { "type": "beat", "line": "Always you." },
    { "type": "chat", "title": "Uni lot", "messages": [ { "from": "Sam", "text": "wenna.app/j/1", "link": { "url": "wenna.app/j/1", "title": "t" } } ] },
    { "type": "screen", "screen": "availability" },
    { "type": "screen", "screen": "locked" },
    { "type": "end", "line": "One link.", "url": "wenna.app" }
  ]
}
\`\`\`

## instagram

> Is it always you who asks? Three weeks of maybe.

hashtags: #friends #melbourne

## bluesky

> It is always the same person asking. A link fixes the asking.
> wenna.app

## youtube

title: Always you

> The same friend asks every time.
`;

function item() {
  const dir = mkdtempSync(join(tmpdir(), 'measure-'));
  const path = join(dir, '2026-11-02-test-piece.md');
  writeFileSync(path, FILE);
  return parseQueueFile(path);
}

const LEDGER = [
  { platform: 'instagram', slug: 'test-piece', at: '2026-11-02T07:31:00Z', kind: 'posted' },
  { platform: 'tiktok', slug: 'test-piece', at: '2026-11-02T07:31:00Z', kind: 'drafted' },
  { platform: 'instagram', slug: 'other', at: '2026-11-01T00:00:00Z' },
];

test('the pure features of a queue file', () => {
  const f = measure(item(), LEDGER, new Date('2026-11-03T00:00:00Z'));
  assert.equal(f.slug, 'test-piece');
  assert.deepEqual(f.hook, { text: "It's always you, 3 weeks in a row", words: 8, number: true, quote: false, time: true });
  assert.equal(f.slides, 9);
  assert.equal(f.components.chatlink, 1);
  assert.equal(f.components.availability, 1);
  assert.equal(f.chats_before_beat, 2);
  assert.deepEqual(f.messages, { total: 4, per_chat: [2, 1, 1], median_len: 5 });
  assert.equal(f.when_stamps, 1);
  assert.equal(f.skip, true);
  assert.deepEqual(f.slow_pace, [2]);
  assert.equal(f.captions, 1);
  assert.equal(f.cast, 3);
  assert.equal(f.quote_source, 'subreddit');
  assert.deepEqual(f.screens, { availability: true, locked: true, compare: false, grid: false });
  assert.deepEqual(f.platforms.instagram, { length: 48, sentences: 2, question: false, link: false, hashtags: 2 });
  assert.equal(f.platforms.bluesky?.link, true);
  assert.equal(f.platforms.youtube?.title_length, 10);
  assert.deepEqual(f.publish_at, { hour: 18, weekday: 'Mon' });
  // the drafted TikTok row is not a post, and another piece's row is not this one's
  assert.deepEqual(f.posted, { instagram: { hour: 18, weekday: 'Mon' } });
  assert.equal(f.timing, undefined);
});

test('a dm split counts both sides as chats before the beat', () => {
  const i = item();
  i.skit!.slides.splice(1, 3, { type: 'split', left: { type: 'chat', title: 'a', messages: [] }, right: { type: 'dm', a: 'X', b: 'Y', messages: [] } } as never);
  const f = measure(i, [], new Date());
  assert.equal(f.chats_before_beat, 2);
  assert.equal(f.components.split, 1);
  assert.equal(f.components.dm, 1);
  assert.equal(f.cast, 3); // Sam from the link chat, X and Y from the dm
});

test('timing: the after is the product on screen, the end card counts towards neither', () => {
  const slides = item().skit!.slides;
  const tokens = slides.map((s) => token(s as never));
  assert.deepEqual(tokens, ['quote', 'chat', 'skip', 'poll', 'beat', 'chatlink', 'availability', 'locked', 'end']);
  const scenes = [3, 5, 2, 4, 2, 3, 3, 3, 2].reduce<{ start: number; end: number }[]>((a, d) => [...a, { start: a.at(-1)?.end ?? 0, end: (a.at(-1)?.end ?? 0) + d }], []);
  assert.deepEqual(timingOf(scenes, tokens, 27.004), { total: 27, before: 16, after: 9, slides: [3, 5, 2, 4, 2, 3, 3, 3, 2] });
});

test('setTiming writes the block once, replaces it after, and readTiming reads it back', () => {
  const t = { total: 27.4, before: 16, after: 9.2, slides: [3, 5.25] };
  const once = setTiming(FILE, t);
  assert.match(once, /\n {2}instagram: "18395365036204751"\ntiming:\n {2}total: 27\.40\n {2}before: 16\.00\n {2}after: 9\.20\n {2}slides: 3\.00 5\.25\n---\n/);
  const twice = setTiming(once, { ...t, total: 28 });
  assert.equal(twice.match(/^timing:/gm)?.length, 1);
  assert.match(twice, /total: 28\.00/);
  const dir = mkdtempSync(join(tmpdir(), 'timing-'));
  writeFileSync(join(dir, 'x.md'), twice);
  const parsed = parseQueueFile(join(dir, 'x.md'));
  assert.deepEqual(readTiming(parsed.fm as never), { ...t, total: 28 });
  assert.equal(parsed.fm.published?.instagram, '18395365036204751');
  assert.equal(measure(parsed, [], new Date()).timing?.total, 28);
});

test('readTiming refuses a block that does not read', () => {
  assert.equal(readTiming({}), undefined);
  assert.equal(readTiming({ timing: { total: 'x', before: '1', after: '1', slides: '1' } }), undefined);
});

test('Melbourne hour, weekday and day across daylight saving', () => {
  assert.deepEqual(melbourne('2026-11-02T07:31:00Z'), { hour: 18, weekday: 'Mon' });
  assert.deepEqual(melbourne('2026-06-02T08:00:00Z'), { hour: 18, weekday: 'Tue' });
  assert.equal(melbourne('not a date'), undefined);
  assert.equal(melbourneDate(new Date('2026-10-21T23:09:00Z')), '2026-10-22');
});

test('sameFeatures ignores when the row was measured', () => {
  const a = measure(item(), LEDGER, new Date('2026-11-03T00:00:00Z'));
  const b = measure(item(), LEDGER, new Date('2026-11-04T00:00:00Z'));
  assert.equal(sameFeatures(a, b), true);
  assert.equal(sameFeatures(a, measure(item(), [], new Date())), false);
});

test('setTiming touches the frontmatter only, never a body line that starts the same way', () => {
  const withBody = FILE + '\ntiming: a line in the piece\n';
  const out = setTiming(withBody, { total: 27, before: 16, after: 9, slides: [27] });
  assert.match(out, /\ntiming: a line in the piece\n$/);
  assert.equal(out.match(/^timing:/gm)?.length, 2);
  assert.match(out, /slides: 27\.00\n---\n/);
});

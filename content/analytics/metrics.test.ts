/**
 * The definitions in metrics.ts, each pinned: the rates per platform and
 * what views being present, absent or zero does to them; quotesHook's two
 * branches; stripHandles against every shape that names a person; the age
 * arithmetic; and the expiry boundary pull.ts and tokens.ts share. Pure
 * functions, so nothing here touches a file or the network.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOKEN_WARN_DAYS, ageDays, ageHours, daysUntil, expiring, quotesHook, rates, stripHandles } from './metrics.ts';

test('rates: with views, every count becomes a count over views; like_rate is there to be shown', () => {
  assert.deepEqual(rates({ views: 2000, reach: 1500, likes: 100, comments: 10, shares: 8, saves: 12, reposts: 2 }, 'instagram'), {
    saves_shares_per_k: 10,
    comments_per_k: 5,
    share_rate: 0.004,
    save_rate: 0.006,
    comment_rate: 0.005,
    like_rate: 0.05,
    repost_rate: 0.001,
  });
  // Threads counts replies, not comments: they feed comments_per_k and nothing else
  assert.deepEqual(rates({ views: 500, replies: 5, reposts: 1, quotes: 1 }, 'threads'), { comments_per_k: 10, repost_rate: 0.002 });
  assert.deepEqual(rates({}, 'tiktok'), {});
});

test('rates: no views at all means engagement, a per-post count, on Bluesky and on any platform that returned none', () => {
  assert.deepEqual(rates({ likes: 4, reposts: 1, replies: 2, quotes: 0 }, 'bluesky'), { engagement: 3 });
  assert.deepEqual(rates({ replies: 2, reposts: 1 }, 'threads'), { engagement: 3 });
  assert.deepEqual(rates({ likes: 9 }, 'bluesky'), {}, 'likes alone are no engagement');
  // Bluesky with a views count (if it ever sends one) gets both
  assert.deepEqual(rates({ views: 100, replies: 2, reposts: 1 }, 'bluesky'), { comments_per_k: 20, repost_rate: 0.01, engagement: 3 });
});

test('rates: zero views is a count, so the post gets no rate and not Bluesky number either', () => {
  assert.deepEqual(rates({ views: 0, replies: 2, reposts: 1, quotes: 0, saves: 1 }, 'threads'), {});
  assert.deepEqual(rates({ views: 0, likes: 3 }, 'instagram'), {});
});

test('rates: watch_pct as given, or from the average watch time over the measured length; skip_pct as given', () => {
  assert.deepEqual(rates({ watch_pct: 41.5, skip_pct: 20 }, 'instagram', 24), { watch_pct: 41.5, skip_pct: 20 });
  assert.deepEqual(rates({ views: 10, watch_avg_s: 6 }, 'youtube', 24), { watch_pct: 25 });
  assert.deepEqual(rates({ views: 10, watch_avg_s: 6.1 }, 'youtube', 23), { watch_pct: 26.5 });
  assert.deepEqual(rates({ watch_avg_s: 6 }, 'youtube'), {}, 'no length, no percentage');
  assert.deepEqual(rates({ watch_avg_s: 6 }, 'youtube', 0), {});
  assert.deepEqual(rates({ watch_pct: 50, watch_avg_s: 6 }, 'youtube', 24), { watch_pct: 50 }, 'the platform figure wins');
});

test('quotesHook: a hook of more than three words is quoted by any three consecutive words of it, in order', () => {
  const hook = '"Group chats never lead anywhere"';
  assert.equal(quotesHook('never lead anywhere', hook), true);
  assert.equal(quotesHook('NEVER LEAD ANYWHERE.', hook), true);
  assert.equal(quotesHook('chats never lead', hook), true);
  assert.equal(quotesHook('so true, group chats never lead anywhere for me', hook), true);
  assert.equal(quotesHook('group chats', hook), false, 'two words are not enough');
  assert.equal(quotesHook('lead anywhere never', hook), false, 'out of order');
  assert.equal(quotesHook('never ever lead anywhere', hook), false, 'not consecutive');
  assert.equal(quotesHook('who always makes plans', 'who always makes plans'), true);
  assert.equal(quotesHook('always makes plans', 'who always makes plans'), true);
  assert.equal(quotesHook('always plans', 'who always makes plans'), false);
});

test('quotesHook: a hook of three or fewer words must appear whole, in order, consecutively', () => {
  assert.equal(quotesHook('nobody moves, ever', 'Nobody moves'), true);
  assert.equal(quotesHook('nobody ever moves', 'Nobody moves'), false);
  assert.equal(quotesHook('moves', 'Nobody moves'), false);
  assert.equal(quotesHook('only one moves', 'only one moves'), true);
  assert.equal(quotesHook('one moves', 'only one moves'), false, 'two of three is not the whole hook');
  assert.equal(quotesHook('', 'Nobody moves'), false);
  assert.equal(quotesHook('a b c', 'a b'), false, 'single letters are not words');
});

test('stripHandles: links, emails, DIDs, handles and u/names become a mark; ordinary text survives', () => {
  assert.equal(stripHandles('dm me at jane.doe@gmail.com'), 'dm me at [email]');
  assert.equal(stripHandles('see instagram.com/@bobsmith and threads.net/@bobsmith'), 'see [link] and [link]');
  assert.equal(stripHandles('bsky.app/profile/carol.bsky.social'), '[link]');
  assert.equal(stripHandles('reddit.com/u/dave_r and /u/erin'), '[link] and /u/…');
  assert.equal(stripHandles('ping did:plc:abcdefg'), 'ping did:…');
  assert.equal(stripHandles('did:web:example.com knows'), 'did:… knows');
  assert.equal(stripHandles('/@bob said so'), '/@… said so');
  assert.equal(stripHandles('so true @someone.bsky.social see https://example.com/x'), 'so true @… see [link]');
  assert.equal(stripHandles('u/throwaway said it first'), 'u/… said it first');
  assert.equal(stripHandles('Group chats never lead anywhere. Mine died in 2019.'), 'Group chats never lead anywhere. Mine died in 2019.');
  assert.equal(stripHandles('try wenna.app'), 'try wenna.app', 'a bare host with no path is not a profile');
  assert.equal(stripHandles('e.g. the group chat'), 'e.g. the group chat');
  assert.equal(stripHandles('wenna.app/?from=bs-only-moves'), '[link]', 'a host with a path is a link');
});

test('ageDays and ageHours: from the posted time to the pull, two decimals', () => {
  const now = new Date('2026-10-21T02:00:00.000Z');
  assert.equal(ageDays('2026-10-19T14:00:00Z', now), 1.5);
  assert.equal(ageHours('2026-10-19T14:00:00Z', now), 36);
  assert.equal(ageDays('2026-10-20T16:00:00Z', now), 0.42);
  assert.equal(ageHours('2026-10-20T16:00:00Z', now), 10);
  assert.equal(ageDays('2026-10-20T07:44:45.414Z', now), 0.76);
});

test('daysUntil: whole days to a date, floored, negative once past, NaN for what is not a date', () => {
  const midnight = new Date('2026-10-22T00:00:00.000Z');
  assert.equal(daysUntil('2026-10-29', midnight), 7);
  assert.equal(daysUntil('2026-10-29', new Date('2026-10-22T10:00:00.000Z')), 6);
  assert.equal(daysUntil('2026-10-22', midnight), 0);
  assert.equal(daysUntil('2026-10-20', midnight), -2);
  assert.ok(Number.isNaN(daysUntil('soon', midnight)));
});

test('expiring: inside TOKEN_WARN_DAYS, the boundary included', () => {
  assert.equal(TOKEN_WARN_DAYS, 7);
  assert.equal(expiring(7), true);
  assert.equal(expiring(8), false);
  assert.equal(expiring(0), true);
  assert.equal(expiring(-3), true);
  assert.equal(expiring(60), false);
  assert.equal(expiring(Number.NaN), false, 'an unreadable date is reported by the caller, not here');
});

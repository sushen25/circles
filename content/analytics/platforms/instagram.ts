/**
 * Instagram, read with the publisher's token (IG_ACCESS_TOKEN, IG_USER_ID).
 * One module, the shape of module.ts, the way publish/adapters.ts has one
 * thin function per platform: nothing here posts, writes or deletes, and
 * every call is a GET through http.ts so no token reaches an error or a
 * log line. The token's own value is blanked out of every response too,
 * because Meta's paging links carry it and `raw` is committed whole.
 *
 * What the probe of 21 October confirmed (docs/analytics-plan.md) decides
 * the metric sets below: a Reel accepts views, reach, saved, shares, likes,
 * comments, total_interactions, the two watch times (milliseconds) and the
 * skip rate (a percentage); `reposts` per media is refused on every API
 * version; the account-level breakdowns all work, and the ones gated on a
 * hundred followers come back empty rather than failing. When a version
 * refuses a metric by name, it is dropped and the call repeated, so a
 * renamed metric costs a column and not the night.
 *
 * Replies leave this file as { id, at, text } and nothing else: the author
 * is read only to drop the account's own comments, and the account's
 * username is held in memory for that one purpose. Handles inside the text
 * are the pull's job (metrics.ts stripHandles).
 */
import { daysUntil, type Metric, type Metrics, type Reply } from '../metrics.ts';
import { HttpError, getJson, redact, withQuery } from './http.ts';
import {
  env,
  needs,
  type AccountFetched,
  type Configured,
  type Fetched,
  type PlatformModule,
  type RecentPost,
  type TokenState,
} from './module.ts';

const DEFAULT_VERSION = 'v21.0';

/** The host the publisher's adapter uses: Instagram Login tokens (IG…) live on graph.instagram.com. */
function host(): string {
  const override = env('IG_GRAPH_HOST');
  if (override) return override;
  return (env('IG_ACCESS_TOKEN') ?? '').startsWith('IG') ? 'graph.instagram.com' : 'graph.facebook.com';
}

const base = (): string => `https://${host()}/${env('IG_API_VERSION') ?? DEFAULT_VERSION}`;

/**
 * The token's own value, blanked wherever it turns up. http.ts redacts the
 * URL and the body of an error; this covers what it cannot know: Meta's
 * `paging` links carry `access_token=` inside a response that goes whole
 * into `raw`, and a refusal might echo the token in its message. The
 * structure of a response is untouched; only the credential is blanked.
 */
function scrubText(s: string): string {
  const token = env('IG_ACCESS_TOKEN');
  let out = s.replace(/(access_token=)[^&\s"']+/gi, '$1…');
  if (token) out = out.split(token).join('…');
  return out;
}

function scrubDeep<T>(v: T): T {
  if (typeof v === 'string') return scrubText(v) as T;
  if (Array.isArray(v)) return v.map(scrubDeep) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)])) as T;
  return v;
}

function scrubError(e: unknown): Error {
  if (e instanceof HttpError) return new HttpError(e.status, e.url, scrubText(e.body));
  return new Error(scrubText(e instanceof Error ? e.message : String(e)));
}

/** The one way out: the token goes through withQuery, never into a string, and comes back out of nothing. */
async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const token = env('IG_ACCESS_TOKEN');
  if (!token) throw new Error('IG_ACCESS_TOKEN unset');
  try {
    return scrubDeep(await getJson<T>(withQuery(`${base()}/${path}`, { ...params, access_token: token })));
  } catch (e) {
    throw scrubError(e);
  }
}

/**
 * A `paging.next` link, re-signed through withQuery and followed only while
 * it stays on our host: the token is never sent where a response points.
 */
async function next<T>(url: string): Promise<T | undefined> {
  const token = env('IG_ACCESS_TOKEN');
  if (!token) throw new Error('IG_ACCESS_TOKEN unset');
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return undefined;
  }
  if (target.origin !== new URL(base()).origin) return undefined;
  try {
    return scrubDeep(await getJson<T>(withQuery(url, { access_token: token })));
  } catch (e) {
    throw scrubError(e);
  }
}

/* ------------------------------------------------------------- the shapes */

type GraphError = { error?: { message?: string; type?: string; code?: number; error_subcode?: number } };

type Media = {
  id: string;
  media_type?: string;
  media_product_type?: string;
  timestamp?: string;
  permalink?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
};

type Paging = { cursors?: { before?: string; after?: string }; next?: string; previous?: string };

type InsightValue = { value?: unknown; end_time?: string };
type Breakdown = { dimension_keys?: string[]; results?: { dimension_values?: string[]; value?: unknown }[] };
type Insight = {
  name: string;
  period?: string;
  title?: string;
  description?: string;
  id?: string;
  values?: InsightValue[];
  total_value?: { value?: unknown; breakdowns?: Breakdown[] };
};
type Insights = { data?: Insight[]; paging?: Paging };

type Comment = { id: string; text?: string; timestamp?: string; username?: string };
type CommentWithReplies = Comment & { replies?: { data?: Comment[] } };
type Comments = { data?: CommentWithReplies[]; paging?: Paging };

type MediaList = { data?: Media[]; paging?: Paging };

/* ------------------------------------------------------------- the helpers */

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The one number an insight carries: `total_value.value` on newer versions, `values[0].value` on older ones. */
function valueOf(i: Insight): number | undefined {
  if (isNumber(i.total_value?.value)) return i.total_value.value;
  const v = i.values?.[0]?.value;
  return isNumber(v) ? v : undefined;
}

/** `total_value.breakdowns[].results[]` as bucket → count, first dimension only. */
function bucketsOf(i: Insight): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of i.total_value?.breakdowns ?? []) {
    for (const r of b.results ?? []) {
      const key = r.dimension_values?.[0];
      if (key !== undefined && isNumber(r.value)) out[key] = (out[key] ?? 0) + r.value;
    }
  }
  return out;
}

/** Meta's `2026-10-21T06:37:08+0000` as ISO; anything unparseable is kept as it came. */
function iso(ts: string | undefined): string | undefined {
  if (!ts) return undefined;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? ts : new Date(ms).toISOString();
}

/** The platform's message for a refused call, token redacted, short enough for a raw.errors entry. */
function describe(e: unknown): string {
  if (e instanceof HttpError) {
    try {
      const body = JSON.parse(e.body) as GraphError;
      if (body.error?.message) return redact(`${e.status} ${body.error.message}`);
    } catch {
      /* not JSON: fall through to the whole message */
    }
    return redact(e.message);
  }
  return redact(e instanceof Error ? e.message : String(e));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/* -------------------------------------------------------------- per media */

const REEL_METRICS = [
  'views',
  'reach',
  'saved',
  'shares',
  'likes',
  'comments',
  'total_interactions',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
  'reels_skip_rate',
];
const FEED_METRICS = ['views', 'reach', 'saved', 'shares', 'likes', 'comments', 'follows', 'profile_visits'];

/** Instagram's name → the common name, and the unit change where there is one. */
const MEDIA_MAP: Record<string, { to: Metric; scale?: (n: number) => number }> = {
  views: { to: 'views' },
  reach: { to: 'reach' },
  saved: { to: 'saves' },
  shares: { to: 'shares' },
  likes: { to: 'likes' },
  comments: { to: 'comments' },
  ig_reels_avg_watch_time: { to: 'watch_avg_s', scale: (ms) => round3(ms / 1000) },
  ig_reels_video_view_total_time: { to: 'watch_total_s', scale: (ms) => round3(ms / 1000) },
  reels_skip_rate: { to: 'skip_pct' },
};

/** The metric names a 400 names, out of the ones we asked for. */
function refused(e: unknown, asked: string[]): string[] {
  if (!(e instanceof HttpError) || e.status !== 400) return [];
  let message = e.body;
  try {
    message = (JSON.parse(e.body) as GraphError).error?.message ?? e.body;
  } catch {
    /* keep the body as the message */
  }
  return asked.filter((m) => new RegExp(`(^|[^a-z_])${m}([^a-z_]|$)`, 'i').test(message));
}

/** Media insights, dropping any metric the version refuses, at most three times over. */
async function mediaInsights(id: string, wanted: string[]): Promise<{ insights: Insights; dropped: string[] }> {
  let asked = wanted;
  const dropped: string[] = [];
  for (let attempt = 0; ; attempt++) {
    try {
      const insights = await get<Insights>(`${id}/insights`, { metric: asked.join(',') });
      return { insights, dropped };
    } catch (e) {
      const names = refused(e, asked);
      if (!names.length || attempt >= 3) throw e;
      dropped.push(...names);
      asked = asked.filter((m) => !names.includes(m));
      if (!asked.length) throw e;
    }
  }
}

async function metrics(id: string): Promise<Fetched> {
  const media = await get<Media>(id, {
    fields: 'id,media_type,media_product_type,timestamp,permalink,like_count,comments_count',
  });
  const wanted = media.media_product_type === 'REELS' ? REEL_METRICS : FEED_METRICS;
  const { insights, dropped } = await mediaInsights(id, wanted);

  const out: Metrics = {};
  for (const i of insights.data ?? []) {
    const m = MEDIA_MAP[i.name];
    const v = valueOf(i);
    if (m && v !== undefined) out[m.to] = m.scale ? m.scale(v) : v;
  }
  // The media object counts likes and comments too; they fill a gap when the insight was refused.
  if (out.likes === undefined && isNumber(media.like_count)) out.likes = media.like_count;
  if (out.comments === undefined && isNumber(media.comments_count)) out.comments = media.comments_count;

  const raw: { media: Media; insights: Insights; dropped?: string[] } = { media, insights };
  if (dropped.length) raw.dropped = dropped;
  return { metrics: out, raw };
}

/* ---------------------------------------------------------------- replies */

/** The account's own username, fetched once per account per process, held only to drop its own comments. */
const ownUsername = new Map<string, Promise<string>>();

function own(): Promise<string> {
  const user = env('IG_USER_ID') ?? '';
  let p = ownUsername.get(user);
  if (!p) {
    p = get<{ username?: string }>('me', { fields: 'username' }).then((me) => {
      if (!me.username) throw new Error('instagram: /me returned no username; cannot tell the account\'s own replies apart');
      return me.username;
    });
    ownUsername.set(user, p);
    p.catch(() => ownUsername.delete(user));
  }
  return p;
}

const MAX_COMMENT_PAGES = 20;

async function replies(id: string, since?: string): Promise<Reply[]> {
  const me = await own();
  const floor = since ? Date.parse(since) : Number.NaN;
  const out: Reply[] = [];

  const keep = (c: Comment) => {
    if (!c.id || c.username === me) return;
    const at = iso(c.timestamp) ?? '';
    if (!Number.isNaN(floor) && at && Date.parse(at) < floor) return;
    out.push({ id: c.id, at, text: c.text ?? '' });
  };

  let page = await get<Comments>(`${id}/comments`, {
    fields: 'id,text,timestamp,username,replies{id,text,timestamp,username}',
    limit: 50,
  });
  for (let n = 1; ; n++) {
    for (const c of page.data ?? []) {
      keep(c);
      for (const r of c.replies?.data ?? []) keep(r);
    }
    const link = page.paging?.next;
    if (!link || n >= MAX_COMMENT_PAGES) break;
    const more = await next<Comments>(link);
    if (!more) break;
    page = more;
  }
  return out;
}

/* ---------------------------------------------------------------- account */

const DAY_S = 86_400;

function dayBounds(day: string): { since: number; until: number } {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`instagram: "${day}" is not a YYYY-MM-DD day`);
  const since = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000;
  if (Number.isNaN(since)) throw new Error(`instagram: "${day}" is not a YYYY-MM-DD day`);
  return { since, until: since + DAY_S };
}

async function account(day: string): Promise<AccountFetched> {
  const user = env('IG_USER_ID');
  if (!user) throw new Error('IG_USER_ID unset');
  const { since, until } = dayBounds(day);
  const metrics: Record<string, number> = {};
  const breakdowns: Record<string, Record<string, number>> = {};
  const raw: Record<string, unknown> & { errors: Record<string, string> } = { errors: {} };

  /** One call, recorded whole, its failure recorded instead of thrown. */
  const call = async (name: string, params: Record<string, string | number | undefined>): Promise<Insights | undefined> => {
    try {
      const res = await get<Insights>(`${user}/insights`, params);
      raw[name] = res;
      return res;
    } catch (e) {
      raw.errors[name] = describe(e);
      return undefined;
    }
  };
  const setMetric = (key: string, i: Insight) => {
    const v = valueOf(i);
    if (v !== undefined) metrics[key] = v;
  };

  // 1, 2: reach and views by follower status and by surface.
  for (const [name, breakdown, suffix] of [
    ['reach_views_follow', 'follow_type', 'by_follow_type'],
    ['reach_views_surface', 'media_product_type', 'by_surface'],
  ] as const) {
    const res = await call(name, { metric: 'reach,views', period: 'day', metric_type: 'total_value', breakdown, since, until });
    for (const i of res?.data ?? []) {
      setMetric(i.name, i);
      breakdowns[`${i.name}_${suffix}`] = bucketsOf(i);
    }
  }

  // 3: the interaction counts by surface.
  {
    const res = await call('interactions_surface', {
      metric: 'likes,comments,shares,saves,total_interactions',
      period: 'day',
      metric_type: 'total_value',
      breakdown: 'media_product_type',
      since,
      until,
    });
    for (const i of res?.data ?? []) {
      setMetric(i.name, i);
      breakdowns[`${i.name}_by_surface`] = bucketsOf(i);
    }
  }

  // 4: replies, reposts (the only place reposts exist) and accounts engaged.
  {
    const res = await call('engaged', { metric: 'replies,reposts,accounts_engaged', period: 'day', metric_type: 'total_value', since, until });
    for (const i of res?.data ?? []) setMetric(i.name, i);
  }

  // 5: taps on the profile's links, by button.
  {
    const res = await call('link_taps', {
      metric: 'profile_links_taps',
      period: 'day',
      metric_type: 'total_value',
      breakdown: 'contact_button_type',
      since,
      until,
    });
    for (const i of res?.data ?? []) {
      if (i.name !== 'profile_links_taps') continue;
      setMetric('link_taps', i);
      breakdowns.link_taps_by_button = bucketsOf(i);
    }
  }

  // 6: followers; empty under a hundred of them.
  {
    const res = await call('followers', { metric: 'follower_count', period: 'day', since, until });
    for (const i of res?.data ?? []) if (i.name === 'follower_count') setMetric('followers', i);
  }

  // 7: follows and unfollows, split.
  {
    const res = await call('follows', {
      metric: 'follows_and_unfollows',
      period: 'day',
      metric_type: 'total_value',
      breakdown: 'follow_type',
      since,
      until,
    });
    for (const i of res?.data ?? []) {
      if (i.name !== 'follows_and_unfollows') continue;
      setMetric('follows_and_unfollows', i);
      breakdowns.follows_by_type = bucketsOf(i);
    }
  }

  // 8: when followers are online, by hour of the day.
  {
    const res = await call('online', { metric: 'online_followers', period: 'lifetime', since, until });
    for (const i of res?.data ?? []) {
      if (i.name !== 'online_followers') continue;
      const v = i.values?.[0]?.value;
      const hours: Record<string, number> = {};
      if (v && typeof v === 'object') {
        for (const [hour, count] of Object.entries(v as Record<string, unknown>)) if (isNumber(count)) hours[hour] = count;
      }
      breakdowns.online_followers_by_hour = hours;
    }
  }

  // 9: who follows, in buckets; empty under a hundred followers. A version
  // that insists on a timeframe gets this month's.
  for (const bucket of ['age', 'city', 'country', 'gender'] as const) {
    const name = `demographics_${bucket}`;
    const params = { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown: bucket };
    let res: Insights | undefined;
    try {
      res = await get<Insights>(`${user}/insights`, params);
    } catch (e) {
      if (/timeframe/i.test(describe(e))) res = await call(name, { ...params, timeframe: 'this_month' });
      else raw.errors[name] = describe(e);
    }
    if (!res) continue;
    raw[name] = res;
    const i = (res.data ?? []).find((d) => d.name === 'follower_demographics');
    breakdowns[`follower_${bucket}`] = i ? bucketsOf(i) : {};
  }

  // 10: reach, day by day, for the last four weeks.
  {
    const res = await call('reach_series', { metric: 'reach', period: 'day', since: since - 28 * DAY_S, until });
    for (const i of res?.data ?? []) {
      if (i.name !== 'reach') continue;
      const series: Record<string, number> = {};
      for (const v of i.values ?? []) {
        if (v.end_time && isNumber(v.value)) series[v.end_time.slice(0, 10)] = v.value;
      }
      breakdowns.reach_by_day = series;
    }
  }

  return { metrics, breakdowns, raw };
}

/* --------------------------------------------------- recent, posted, ids */

const MEDIA_FIELDS = 'id,caption,timestamp,permalink,media_product_type';

async function mediaPage(): Promise<MediaList> {
  const user = env('IG_USER_ID');
  if (!user) throw new Error('IG_USER_ID unset');
  return get<MediaList>(`${user}/media`, { fields: MEDIA_FIELDS, limit: 25 });
}

async function recent(): Promise<RecentPost[]> {
  const page = await mediaPage();
  return (page.data ?? []).map((m) => ({ id: m.id, at: iso(m.timestamp) ?? '', text: m.caption ?? '' }));
}

async function postedAt(id: string): Promise<string | undefined> {
  const media = await get<Media>(id, { fields: 'id,timestamp' });
  return iso(media.timestamp);
}

const SHORTCODE = /instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels)\/([A-Za-z0-9_-]+)/i;
const MAX_ID_PAGES = 4;

async function parseId(urlOrId: string): Promise<string> {
  const s = urlOrId.trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(SHORTCODE);
  if (!m) throw new Error(`instagram: "${s}" is neither a media id nor an instagram.com/p|reel/<code> link`);
  const code = m[1];
  let page = await mediaPage();
  for (let n = 1; ; n++) {
    const hit = (page.data ?? []).find((x) => x.permalink?.includes(`/${code}/`));
    if (hit) return hit.id;
    const link = page.paging?.next;
    if (!link || n >= MAX_ID_PAGES) break;
    const more = await next<MediaList>(link);
    if (!more) break;
    page = more;
  }
  throw new Error(`instagram: no post with shortcode "${code}" in the account's last ${MAX_ID_PAGES * 25} posts`);
}

/* ------------------------------------------------------------------ token */

async function token(): Promise<TokenState> {
  const c = needs('IG_ACCESS_TOKEN', 'IG_USER_ID');
  const state: TokenState = { platform: 'instagram', configured: c.ok };
  const expires = env('IG_TOKEN_EXPIRES');
  if (expires) {
    state.expires = expires;
    const left = daysUntil(expires, new Date());
    if (!Number.isNaN(left)) state.daysLeft = left;
  }
  if (!c.ok) {
    state.note = c.reason;
    return state;
  }
  try {
    await get<{ id?: string }>('me', { fields: 'id' });
    state.note = 'accepted';
  } catch (e) {
    state.note = `refused: ${describe(e)}`;
  }
  return state;
}

/* ----------------------------------------------------------------- module */

export const instagram: PlatformModule = {
  platform: 'instagram',
  configured: (): Configured => needs('IG_ACCESS_TOKEN', 'IG_USER_ID'),
  metrics,
  replies,
  account,
  recent,
  postedAt,
  parseId,
  token,
};

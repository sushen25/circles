/**
 * Threads, read-only, for the nightly pull (docs/analytics-plan.md, "Pull"
 * and "What each platform can give"). Reads with the publisher's own
 * credentials (THREADS_ACCESS_TOKEN, THREADS_USER_ID) against
 * graph.threads.net, GET only: nothing here posts, edits or deletes.
 *
 * Built to the documentation rather than to a live token: the probe on
 * 21 October found the token in use is a placeholder ("Cannot parse access
 * token"), so until the OAuth sign-in that gives a long-lived token with
 * threads_basic, threads_manage_insights and threads_read_replies, every
 * method here either says "not configured" or carries the refusal through
 * as a redacted error. The shapes it reads are the documented ones:
 *
 *   /<id>?fields=…                   the post itself (media_type, timestamp, permalink, text)
 *   /<id>/insights?metric=…          { data: [{ name, period, values: [{ value }] | total_value: { value } }] }
 *   /<id>/conversation, /<id>/replies   the thread, paged by cursors.after
 *   /<user>/threads_insights         the account by day; views is a series, the rest total_value
 *   /<user>/threads                  recent posts, for parseId
 *   /me?fields=id                    whether the token is accepted at all
 *
 * Two rules shape the code more than the API does. The token only ever
 * travels through withQuery/getJson, never into a string that could be
 * logged, and it is blanked out of every response on the way in (Meta's
 * paging links carry it, and raw is committed whole) and out of every
 * error on the way out; THREADS_USER_ID is the account's id, which the
 * workflows pass as a variable rather than a secret, and it is blanked
 * from stored errors all the same, since an id in an error line helps
 * nobody. And no person leaves this file: replies return { id, at, text }
 * with the author dropped and the account's own replies removed, and the
 * account's demographics are the bucketed counts Threads gives above 100
 * followers.
 */
import type { Metrics, Reply } from '../metrics.ts';
import { daysUntil } from '../metrics.ts';
import { getJson, HttpError, redact, withQuery } from './http.ts';
import { env, needs, type AccountFetched, type Configured, type Fetched, type PlatformModule, type RecentPost, type TokenState } from './module.ts';

const BASE = 'https://graph.threads.net/v1.0';

/** The six per-post metrics Threads documents; every name is already a common one. */
const POST_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'] as const;
type PostMetric = (typeof POST_METRICS)[number];

/** Account metrics that take since/until; followers_count does not, so it goes in a call of its own. */
const ACCOUNT_METRICS = 'views,likes,replies,reposts,quotes,clicks';
const DEMOGRAPHIC_BREAKDOWNS = ['country', 'city', 'age', 'gender'] as const;

/** Pages of 50 replies a thread may run to before the pull stops reading; four pages of 25 posts is as far back as parseId looks. */
const REPLY_PAGE_CAP = 20;
const RECENT_PAGE_CAP = 4;
const RECENT_LIMIT = 25;

type Paging = { cursors?: { before?: string; after?: string }; next?: string; previous?: string };
type Page<T> = { data?: T[]; paging?: Paging };
type Media = { id?: string; media_type?: string; timestamp?: string; permalink?: string; text?: string };
type BreakdownResult = { dimension_values?: string[]; value?: number };
type Breakdown = { dimension_keys?: string[]; results?: BreakdownResult[] };
type Insight = {
  name?: string;
  period?: string;
  values?: { value?: number; end_time?: string }[];
  total_value?: { value?: number; breakdowns?: Breakdown[] };
  /** how `clicks` comes back: one entry per link on the account's profile and posts */
  link_total_values?: { value?: number; link_url?: string }[];
};
type Insights = { data?: Insight[] };
type ReplyItem = { id?: string; text?: string; timestamp?: string; username?: string; is_reply_owned_by_me?: boolean };

const accessToken = (): string => {
  const t = env('THREADS_ACCESS_TOKEN');
  if (!t) throw new Error('THREADS_ACCESS_TOKEN unset');
  return t;
};

const userId = (): string => {
  const u = env('THREADS_USER_ID');
  if (!u) throw new Error('THREADS_USER_ID unset');
  return u;
};

/**
 * The token's own value, blanked wherever it turns up. http.ts redacts the
 * URL and the body of an error; this covers what it cannot know: Meta's
 * `paging` links carry `access_token=` inside a response that goes whole
 * into `raw`, and a refusal might echo the token in its message. The
 * structure of a response is untouched; only the credential is blanked.
 */
function scrubText(s: string): string {
  const token = env('THREADS_ACCESS_TOKEN');
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

/** One GET against the Graph host; the token goes in as a query parameter, never interpolated, and comes back out of nothing: every response and every error is scrubbed. */
async function call<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  try {
    return scrubDeep(await getJson<T>(withQuery(`${BASE}/${path}`, { ...params, access_token: accessToken() })));
  } catch (e) {
    throw scrubError(e);
  }
}

/**
 * An error as it may be written to a file: the token is already blank
 * (http.ts and scrubError), and the account id is blanked here too; it is
 * not a secret, but nothing in a stored error needs it.
 */
function safeMessage(e: unknown): string {
  const msg = redact(e instanceof Error ? e.message : String(e));
  const user = env('THREADS_USER_ID');
  return user ? msg.split(user).join('<user>') : msg;
}

/**
 * Meta writes timestamps as 2026-10-21T03:15:00+0000, which is not quite
 * ISO 8601; the pull does date arithmetic on `at`, so it is normalised here.
 * Anything unparseable is passed through rather than invented.
 */
function iso(ts: string | undefined): string {
  if (!ts) return '';
  const fixed = ts.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(fixed);
  return Number.isNaN(ms) ? ts : new Date(ms).toISOString();
}

/**
 * The day a `values[].end_time` point describes. Meta labels a day bucket
 * with the Pacific midnight that ends it (07:00 or 08:00 UTC the next
 * morning), so the date in the label is one day late; twelve hours back
 * lands inside the day the bucket covers, whichever offset is in force. A
 * label that does not parse keeps its first ten characters.
 */
function bucketDay(endTime: string | undefined): string {
  const stamp = iso(endTime);
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? stamp.slice(0, 10) : new Date(ms - 12 * 3_600_000).toISOString().slice(0, 10);
}

/** A metric's number, from either documented shape: `total_value.value`, or `values[]` summed (a lifetime value sums to itself, a day series to its total). */
function valueOf(d: Insight): number | undefined {
  if (typeof d.total_value?.value === 'number') return d.total_value.value;
  if (Array.isArray(d.values)) {
    const nums = d.values.map((v) => v.value).filter((v): v is number => typeof v === 'number');
    if (nums.length) return nums.reduce((a, b) => a + b, 0);
  }
  return undefined;
}

const isHttp = (e: unknown, ...statuses: number[]): e is HttpError => e instanceof HttpError && statuses.includes(e.status);

/** since/until, in unix seconds, for one UTC day written YYYY-MM-DD. */
function dayWindow(day: string): { since: number; until: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`day "${day}" is not YYYY-MM-DD`);
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(start)) throw new Error(`day "${day}" is not a date`);
  return { since: Math.floor(start / 1000), until: Math.floor(start / 1000) + 86_400 - 1 };
}

function configured(): Configured {
  return needs('THREADS_ACCESS_TOKEN', 'THREADS_USER_ID');
}

async function media(id: string): Promise<Media> {
  return call<Media>(id, { fields: 'id,media_type,timestamp,permalink,text' });
}

async function metrics(id: string): Promise<Fetched> {
  const post = await media(id);
  const insights = await call<Insights>(`${id}/insights`, { metric: POST_METRICS.join(',') });
  const m: Metrics = {};
  for (const d of insights.data ?? []) {
    const name = d.name as PostMetric;
    if (!POST_METRICS.includes(name)) continue;
    const v = valueOf(d);
    if (v !== undefined) m[name] = v;
  }
  return { metrics: m, raw: { media: post, insights } };
}

/**
 * The thread under a post, oldest first, page by page. /conversation gives
 * every reply including nested ones; when it is refused (the token lacks
 * the scope, or the post predates it) /replies, the top level only, is the
 * fallback. Each item leaves as { id, at, text }: the username Threads
 * returns is read and discarded, and the account's own replies are dropped
 * by the flag Threads sets for them.
 */
async function replies(id: string, since?: string): Promise<Reply[]> {
  const fields = 'id,text,timestamp,username,is_reply_owned_by_me';
  const sinceMs = since ? Date.parse(since) : NaN;
  const out: Reply[] = [];
  let edge: 'conversation' | 'replies' = 'conversation';
  let after: string | undefined;
  for (let page = 0; page < REPLY_PAGE_CAP; page++) {
    let res: Page<ReplyItem>;
    try {
      res = await call<Page<ReplyItem>>(`${id}/${edge}`, { fields, reverse: 'false', limit: 50, after });
    } catch (e) {
      if (edge === 'conversation' && page === 0 && isHttp(e, 400, 403)) {
        edge = 'replies';
        res = await call<Page<ReplyItem>>(`${id}/${edge}`, { fields, reverse: 'false', limit: 50 });
      } else {
        throw e;
      }
    }
    for (const item of res.data ?? []) {
      if (!item.id || item.is_reply_owned_by_me === true) continue;
      const at = iso(item.timestamp);
      if (!Number.isNaN(sinceMs) && at && Date.parse(at) < sinceMs) continue;
      out.push({ id: String(item.id), at, text: item.text ?? '' });
    }
    after = res.paging?.cursors?.after;
    if (!after || !(res.data ?? []).length) break;
  }
  return out;
}

/**
 * The account on one day. Each call is tried on its own and a refusal lands
 * in raw.errors under the call's name, so a metric the token cannot read
 * (demographics under 100 followers, or a missing scope) never loses the
 * rest. followers_count is documented without since/until, hence its own call.
 */
async function account(day: string): Promise<AccountFetched> {
  const { since, until } = dayWindow(day);
  const user = userId();
  const m: Record<string, number> = {};
  const breakdowns: Record<string, Record<string, number>> = {};
  const raw: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  const attempt = async (name: string, params: Record<string, string | number | undefined>): Promise<Insights | undefined> => {
    try {
      const res = await call<Insights>(`${user}/threads_insights`, params);
      raw[name] = res;
      return res;
    } catch (e) {
      errors[name] = safeMessage(e);
      return undefined;
    }
  };

  const insights = await attempt('insights', { metric: ACCOUNT_METRICS, since, until });
  for (const d of insights?.data ?? []) {
    const v = valueOf(d);
    switch (d.name) {
      case 'views': {
        if (v === undefined) break;
        m.views = v;
        const series: Record<string, number> = {};
        (d.values ?? []).forEach((point, i) => {
          if (typeof point.value === 'number') series[bucketDay(point.end_time) || `point_${i}`] = point.value;
        });
        if (Object.keys(series).length) breakdowns.views_by_day = series;
        break;
      }
      case 'likes':
      case 'replies':
      case 'reposts':
      case 'quotes':
        if (v !== undefined) m[d.name] = v;
        break;
      case 'clicks': {
        // Documented as link_total_values, one entry per link; the day's clicks is their sum, and the split is kept by link (the account's own).
        const links = d.link_total_values;
        if (Array.isArray(links)) {
          const byLink: Record<string, number> = {};
          let total = 0;
          for (const l of links) {
            if (typeof l.value !== 'number') continue;
            total += l.value;
            const key = l.link_url || 'unknown';
            byLink[key] = (byLink[key] ?? 0) + l.value;
          }
          m.clicks = total;
          m.link_taps = total;
          if (Object.keys(byLink).length) breakdowns.clicks_by_link = byLink;
        } else if (v !== undefined) {
          m.clicks = v;
          m.link_taps = v;
        }
        break;
      }
    }
  }

  const followers = await attempt('followers', { metric: 'followers_count' });
  for (const d of followers?.data ?? []) {
    const v = valueOf(d);
    if (d.name === 'followers_count' && v !== undefined) m.followers = v;
  }

  for (const dim of DEMOGRAPHIC_BREAKDOWNS) {
    const res = await attempt(`demographics_${dim}`, { metric: 'follower_demographics', breakdown: dim });
    const buckets: Record<string, number> = {};
    for (const d of res?.data ?? []) {
      for (const b of d.total_value?.breakdowns ?? []) {
        for (const r of b.results ?? []) {
          if (typeof r.value !== 'number') continue;
          const key = (r.dimension_values ?? []).join('/') || 'unknown';
          buckets[key] = (buckets[key] ?? 0) + r.value;
        }
      }
    }
    if (Object.keys(buckets).length) breakdowns[`follower_${dim}`] = buckets;
  }

  if (Object.keys(errors).length) raw.errors = errors;
  return { metrics: m, breakdowns, raw };
}

async function recentPage(after?: string): Promise<Page<Media>> {
  return call<Page<Media>>(`${userId()}/threads`, { fields: 'id,text,timestamp,permalink,media_type', limit: RECENT_LIMIT, after });
}

async function recent(): Promise<RecentPost[]> {
  const page = await recentPage();
  return (page.data ?? []).filter((p) => p.id).map((p) => ({ id: String(p.id), at: iso(p.timestamp), text: p.text ?? '' }));
}

async function postedAt(id: string): Promise<string | undefined> {
  const post = await media(id);
  return post.timestamp ? iso(post.timestamp) : undefined;
}

/** threads.net or threads.com, with or without scheme or www, `/@<handle>/post/<code>`, anything after the code ignored. */
const POST_URL = /^(?:https?:\/\/)?(?:www\.)?threads\.(?:net|com)\/@[^/\s]+\/post\/([A-Za-z0-9_-]+)/i;

/**
 * The ledger holds Threads' numeric media id, and a pasted URL carries only
 * the post's short code. Threads offers no lookup by code, so the account's
 * recent posts are scanned for the permalink that carries it.
 */
async function parseId(urlOrId: string): Promise<string> {
  const s = urlOrId.trim();
  if (/^\d+$/.test(s)) return s;
  const m = POST_URL.exec(s);
  if (!m) throw new Error(`${JSON.stringify(redact(s))} is not a Threads post id or a threads.net/@…/post/… URL`);
  const code = m[1];
  const needle = `/post/${code}`;
  let after: string | undefined;
  for (let page = 0; page < RECENT_PAGE_CAP; page++) {
    const res = await recentPage(after);
    for (const p of res.data ?? []) {
      if (p.id && p.permalink && p.permalink.split('?')[0].endsWith(needle)) return String(p.id);
    }
    after = res.paging?.cursors?.after;
    if (!after || !(res.data ?? []).length) break;
  }
  throw new Error(`post ${needle} is not among the account's last ${RECENT_PAGE_CAP * RECENT_LIMIT} Threads posts; paste its numeric id instead`);
}

async function token(): Promise<TokenState> {
  const state: TokenState = { platform: 'threads', configured: false };
  const c = configured();
  if (!c.ok) return { ...state, note: c.reason };
  state.configured = true;
  const expires = env('THREADS_TOKEN_EXPIRES');
  if (expires) {
    const days = daysUntil(expires, new Date());
    if (!Number.isNaN(days)) {
      state.expires = expires;
      state.daysLeft = days;
    } else {
      state.note = `THREADS_TOKEN_EXPIRES "${expires}" is not a date`;
    }
  }
  try {
    await call<{ id?: string }>('me', { fields: 'id' });
    state.note = state.note ? `accepted; ${state.note}` : 'accepted';
  } catch (e) {
    state.note = `refused: ${safeMessage(e)}`;
  }
  return state;
}

export const threads: PlatformModule = {
  platform: 'threads',
  configured,
  metrics,
  replies,
  account,
  recent,
  postedAt,
  parseId,
  token,
};

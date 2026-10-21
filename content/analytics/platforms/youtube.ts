/**
 * YouTube, read-only (docs/analytics-plan.md, "What each platform can give").
 *
 * Two ways in, and the module uses whichever it has. A plain API key
 * (YOUTUBE_API_KEY) reads public numbers and comment text from the Data API
 * with no consent. The OAuth refresh token the publisher holds
 * (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN) carried,
 * as of 21 October 2026, youtube.upload alone, which reads nothing; once it
 * is re-consented with youtube.readonly it reads the channel and its private
 * Shorts, and with yt-analytics.readonly it reads the Analytics API, which
 * is where retention, traffic sources and watch time live. The scopes are
 * learned once per process from Google's tokeninfo; a token that cannot be
 * fetched counts as no OAuth, and the key carries on alone.
 *
 * Data API calls send a bearer when the token can read, else the key as a
 * query parameter, always through http.ts so neither reaches an error line.
 * The Analytics API needs the bearer whatever the Data API used. Every
 * response is kept whole in `raw`, keyed by what it was (video, analytics,
 * retention ...), and a report that is refused lands in `raw.errors` under
 * the same key while the rest carries on.
 *
 * A read these credentials cannot make at all (a private Short with a key
 * alone, a refresh token with the upload scope only) is thrown as
 * Unreadable (module.ts), which the pull logs as a skip rather than a
 * failure: repeating it changes nothing.
 *
 * Nothing here posts, writes or changes anything: GET only. The author of a
 * comment is dropped before it leaves this file, and so is any comment by
 * the channel itself. The access token, its scopes and each video's record
 * are learned once per process; `reset()` forgets them, for the tests.
 */
import { youtubeAccessToken, youtubeScopes } from '../../publish/youtube-token.ts';
import type { Metric, Metrics, Reply } from '../metrics.ts';
import { HttpError, getJson, redact, withQuery } from './http.ts';
import { env, needs, Unreadable, type AccountFetched, type Configured, type Fetched, type PlatformModule, type RecentPost, type TokenState } from './module.ts';

const DATA = 'https://www.googleapis.com/youtube/v3';
const REPORTS = 'https://youtubeanalytics.googleapis.com/v2/reports';

const OAUTH_VARS = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'];

/**
 * Scope names as tokeninfo lists them, less the `https://www.googleapis.com/auth/`
 * prefix. The broad `youtube` and `youtube.force-ssl` scopes do everything
 * upload and readonly do, so they count for both.
 */
const UPLOAD = ['youtube.upload', 'youtube', 'youtube.force-ssl'];
const READ = ['youtube.readonly', 'youtube', 'youtube.force-ssl'];
const ANALYTICS = ['yt-analytics.readonly', 'yt-analytics-monetary.readonly'];
const short = (scopes: string[]) => scopes.map((s) => s.replace(/^.*\/auth\//, ''));
const has = (scopes: string[], names: string[]) => short(scopes).some((s) => names.includes(s));

const ID = /^[A-Za-z0-9_-]{11}$/;

type Params = Record<string, string | number | undefined>;
type Raw = { errors?: Record<string, string>; [k: string]: unknown };
type List<T> = { items?: T[]; nextPageToken?: string };
type Video = {
  id: string;
  snippet?: { publishedAt?: string; channelId?: string; title?: string; description?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
};
type Channel = {
  id: string;
  statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};
type Comment = {
  id: string;
  snippet?: { publishedAt?: string; textOriginal?: string; textDisplay?: string; authorChannelId?: { value?: string } };
};
/** `replies.comments` is a subset of the thread; `totalReplyCount` says whether there are more. */
type Thread = { id: string; snippet?: { topLevelComment?: Comment; totalReplyCount?: number }; replies?: { comments?: Comment[] } };
type PlaylistItem = {
  snippet?: { publishedAt?: string; title?: string; description?: string };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
};
/** The Analytics API's answer: a column list and rows of cells in that order. Kept whole in raw. */
type Report = { columnHeaders?: { name: string }[]; rows?: (string | number)[][] };

/** Today, YYYY-MM-DD UTC, the one way this module reads the date; the tests pin it. */
export const clock = { today: () => new Date().toISOString().slice(0, 10) };

/** YYYY-MM-DD, `n` days before a date or a date-time; undefined when it is neither. */
const daysBefore = (date: string | undefined, n: number): string | undefined => {
  const ms = date ? Date.parse(date) : Number.NaN;
  return Number.isNaN(ms) ? undefined : new Date(ms - n * 86_400_000).toISOString().slice(0, 10);
};
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const set = (m: Metrics, k: Metric, v: unknown) => {
  const n = num(v);
  if (n !== undefined) m[k] = n;
};
const put = (m: Record<string, number>, k: string, v: unknown) => {
  const n = num(v);
  if (n !== undefined) m[k] = n;
};
const colIndex = (r: Report, name: string): number => r.columnHeaders?.findIndex((h) => h.name === name) ?? -1;
/** A cell under a named column, from the first row unless one is given, or undefined when the report has neither. */
const col = (r: Report, name: string, row: (string | number)[] | undefined = r.rows?.[0]): unknown => {
  const i = colIndex(r, name);
  return i >= 0 ? row?.[i] : undefined;
};
/** The row whose cell under the dimension `dim` is `value`. */
const rowWhere = (r: Report, dim: string, value: string): (string | number)[] | undefined => {
  const i = colIndex(r, dim);
  return i >= 0 ? r.rows?.find((row) => String(row[i]) === value) : undefined;
};

/* ------------------------------------------------------------------ auth */

type OAuth = { token?: string; scopes: string[]; error?: string };
let oauth: Promise<OAuth> | undefined;

/** The access token and its scopes, fetched once per process; a failure is remembered as "no OAuth" with its reason. */
function oauthState(): Promise<OAuth> {
  oauth ??= (async (): Promise<OAuth> => {
    if (!needs(...OAUTH_VARS).ok) return { scopes: [] };
    try {
      const token = await youtubeAccessToken();
      return { token, scopes: await youtubeScopes(token) };
    } catch (e) {
      return { scopes: [], error: redact(messageOf(e)) };
    }
  })();
  return oauth;
}

type Auth = {
  /** how the Data API is called: a bearer that can read, or the key in the query */
  data: { bearer: string } | { key: string };
  /** the bearer for the Analytics API, when the token carries the scope */
  analytics?: string;
  /** the token reads private videos and the channel as `mine` */
  read: boolean;
};

async function auth(): Promise<Auth> {
  const o = await oauthState();
  const analytics = o.token && has(o.scopes, ANALYTICS) ? o.token : undefined;
  if (o.token && has(o.scopes, READ)) return { data: { bearer: o.token }, analytics, read: true };
  const key = env('YOUTUBE_API_KEY');
  if (key) return { data: { key }, analytics, read: false };
  if (o.token) {
    throw new Unreadable(
      `YouTube: the refresh token has ${short(o.scopes).join(', ') || 'no scopes'} only, not youtube.readonly, and YOUTUBE_API_KEY is unset; re-consent with npm run auth:youtube or set a key`,
    );
  }
  if (o.error) throw new Error(`YouTube: YOUTUBE_API_KEY is unset and the OAuth token could not be fetched: ${o.error}`);
  throw new Error('YouTube: YOUTUBE_API_KEY unset and no OAuth credentials');
}

const bearer = (token: string) => ({ Authorization: 'Bearer ' + token });

/** One Data API GET with whichever credential the module has; the key goes through withQuery, the bearer in a header. */
async function data<T>(path: string, params: Params): Promise<T> {
  const a = await auth();
  if ('key' in a.data) return getJson<T>(withQuery(`${DATA}/${path}`, { ...params, key: a.data.key }));
  return getJson<T>(withQuery(`${DATA}/${path}`, params), { headers: bearer(a.data.bearer) });
}

function report(token: string, params: Params): Promise<Report> {
  return getJson<Report>(withQuery(REPORTS, params), { headers: bearer(token) });
}

/** Run one call, keep its answer under `name`, and on failure keep the redacted reason under `errors[name]` instead. */
async function tolerant<T>(raw: Raw, name: string, call: () => Promise<T>): Promise<T | undefined> {
  try {
    const r = await call();
    raw[name] = r;
    return r;
  } catch (e) {
    (raw.errors ??= {})[name] = redact(messageOf(e));
    return undefined;
  }
}

/* ----------------------------------------------------------------- video */

const videos = new Map<string, Promise<List<Video>>>();

/**
 * The video's own record, one call per id per process: metrics() always
 * fetches it fresh (the numbers are the point) and replies() and postedAt()
 * reuse what is there. A failed call is forgotten so the next caller retries.
 */
function video(id: string, fresh = false): Promise<List<Video>> {
  let p = fresh ? undefined : videos.get(id);
  if (!p) {
    const call = data<List<Video>>('videos', { part: 'statistics,snippet,contentDetails,status', id });
    p = call;
    call.catch(() => {
      if (videos.get(id) === call) videos.delete(id);
    });
    videos.set(id, call);
  }
  return p;
}

/** Forget the learned token, scopes and video records. For the tests. */
export function reset(): void {
  oauth = undefined;
  videos.clear();
}

/** Every reply under a top-level comment, by page: commentThreads embeds only some of them. */
async function repliesUnder(parentId: string): Promise<Comment[]> {
  const out: Comment[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const list = await data<List<Comment>>('comments', { part: 'snippet', parentId, maxResults: 100, textFormat: 'plainText', pageToken });
    out.push(...(list.items ?? []));
    pageToken = list.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** The Analytics breakdowns per video, each a tolerant call keyed by name in raw. */
const VIDEO_REPORTS: [name: string, params: Params][] = [
  ['retention', { metrics: 'audienceWatchRatio,relativeRetentionPerformance', dimensions: 'elapsedVideoTimeRatio' }],
  ['traffic', { metrics: 'views', dimensions: 'insightTrafficSourceType' }],
  ['subscribed', { metrics: 'views,estimatedMinutesWatched', dimensions: 'subscribedStatus' }],
  ['playback', { metrics: 'views,estimatedMinutesWatched', dimensions: 'insightPlaybackLocationType' }],
  ['device', { metrics: 'views,estimatedMinutesWatched', dimensions: 'deviceType' }],
  ['country', { metrics: 'views,estimatedMinutesWatched', dimensions: 'country', sort: '-views', maxResults: 10 }],
  ['sharing', { metrics: 'shares', dimensions: 'sharingService' }],
  ['by_day', { metrics: 'views,estimatedMinutesWatched', dimensions: 'day' }],
];

/** `mine=true` when the token can read the channel, else the channel id the env names; neither is an error the caller words. */
function channelParams(a: Auth): Params | undefined {
  if (a.read) return { mine: 'true' };
  const id = env('YOUTUBE_CHANNEL_ID');
  return id ? { id } : undefined;
}

/* ---------------------------------------------------------------- module */

export const youtube: PlatformModule = {
  platform: 'youtube',

  configured(): Configured {
    const key = needs('YOUTUBE_API_KEY');
    const o = needs(...OAUTH_VARS);
    if (key.ok || o.ok) return { ok: true };
    return { ok: false, reason: `${key.reason}; for OAuth instead, ${o.reason}` };
  },

  async metrics(id: string): Promise<Fetched> {
    const a = await auth();
    const raw: Raw = {};
    const list = await video(id, true);
    raw.video = list;
    const v = list.items?.[0];
    if (!v) {
      // A key lists nothing for a private video: unreadable with these credentials, so the pull skips it.
      // The bearer sees the channel's own private videos, so with it an empty list is a video that is gone.
      if (!a.read) throw new Unreadable(`YouTube video ${id}: not found; a private Short is readable only with youtube.readonly`);
      throw new Error(`YouTube video ${id}: not found (deleted, or not this channel's)`);
    }
    const m: Metrics = {};
    set(m, 'views', v.statistics?.viewCount);
    set(m, 'likes', v.statistics?.likeCount);
    set(m, 'comments', v.statistics?.commentCount);

    if (a.analytics) {
      const token = a.analytics;
      // Analytics days are Pacific, so the window opens the day before the UTC publish date; the video filter makes the early start harmless.
      const base: Params = {
        ids: 'channel==MINE',
        startDate: daysBefore(v.snippet?.publishedAt, 1) ?? clock.today(),
        endDate: clock.today(),
        filters: `video==${id}`,
      };
      const r = await tolerant(raw, 'analytics', () =>
        report(token, {
          ...base,
          metrics: 'views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,shares,subscribersGained,likes,comments',
        }),
      );
      if (r) {
        set(m, 'engaged_views', col(r, 'engagedViews'));
        const minutes = num(col(r, 'estimatedMinutesWatched'));
        if (minutes !== undefined) m.watch_total_s = minutes * 60;
        set(m, 'watch_avg_s', col(r, 'averageViewDuration'));
        set(m, 'watch_pct', col(r, 'averageViewPercentage'));
        set(m, 'shares', col(r, 'shares'));
      }
      for (const [name, params] of VIDEO_REPORTS) await tolerant(raw, name, () => report(token, { ...base, ...params }));
    }
    return { metrics: m, raw };
  },

  async replies(id: string, since?: string): Promise<Reply[]> {
    const v = (await video(id)).items?.[0];
    // With a key the Data API lists nothing for a private video, and there is nothing to read.
    if (!v) return [];
    const own = v.snippet?.channelId;
    const floor = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
    const at = (c: Comment) => Date.parse(c.snippet?.publishedAt ?? '');
    const out: Reply[] = [];
    let pageToken: string | undefined;
    // Threads come newest first, so once a page reaches a thread older than `since` the rest can go.
    for (let page = 0; page < 10; page++) {
      let threads: List<Thread>;
      try {
        threads = await data<List<Thread>>('commentThreads', {
          part: 'snippet,replies',
          videoId: id,
          textFormat: 'plainText',
          maxResults: 100,
          pageToken,
        });
      } catch (e) {
        if (e instanceof HttpError && e.status === 403 && /commentsDisabled/.test(e.body)) return out;
        throw e;
      }
      let older = false;
      for (const t of threads.items ?? []) {
        const top = t.snippet?.topLevelComment;
        if (top && at(top) < floor) older = true;
        // The thread embeds a subset of its replies; when the count says there are more, they are listed by parent instead.
        const embedded = t.replies?.comments ?? [];
        const replies = top && (num(t.snippet?.totalReplyCount) ?? 0) > embedded.length ? await repliesUnder(top.id) : embedded;
        for (const c of [top, ...replies]) {
          if (!c?.snippet) continue;
          if (own && c.snippet.authorChannelId?.value === own) continue;
          if (at(c) < floor) continue;
          out.push({ id: c.id, at: c.snippet.publishedAt ?? '', text: c.snippet.textOriginal ?? c.snippet.textDisplay ?? '' });
        }
      }
      pageToken = threads.nextPageToken;
      if (!pageToken || older) break;
    }
    return out;
  },

  /**
   * The channel as it stands (subscribers, views, videos: today's numbers)
   * and, with the analytics scope, the day's row. The Analytics API has
   * not usually finished `day` by the time the pull runs, so the ask is a
   * trailing week by day, kept whole in raw.by_day; the metrics are filled
   * from the row for `day` when it is there, and when it is not yet,
   * raw.errors.analytics_day says so and the next night's row has it.
   * `day` is returned, as today, only when nothing by-day was read.
   */
  async account(day: string): Promise<AccountFetched> {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(day) ? daysBefore(day, 6) : undefined;
    if (!start) throw new Error(`YouTube: "${day}" is not a YYYY-MM-DD day`);
    const a = await auth();
    const who = channelParams(a);
    if (!who) throw new Error('YouTube: YOUTUBE_CHANNEL_ID unset and no readonly scope');
    const raw: Raw = {};
    const metrics: Record<string, number> = {};
    const ch = await tolerant(raw, 'channel', () => data<List<Channel>>('channels', { part: 'statistics,contentDetails', ...who }));
    const st = ch?.items?.[0]?.statistics;
    if (st) {
      put(metrics, 'subscribers', st.subscriberCount);
      put(metrics, 'views', st.viewCount);
      put(metrics, 'videos', st.videoCount);
    }
    let byDay: Report | undefined;
    if (a.analytics) {
      const token = a.analytics;
      byDay = await tolerant(raw, 'by_day', () =>
        report(token, {
          ids: 'channel==MINE',
          startDate: start,
          endDate: day,
          dimensions: 'day',
          metrics: 'views,subscribersGained,subscribersLost,estimatedMinutesWatched',
        }),
      );
      if (byDay) {
        const row = rowWhere(byDay, 'day', day);
        if (row) {
          put(metrics, 'views_day', col(byDay, 'views', row));
          put(metrics, 'subscribers_gained', col(byDay, 'subscribersGained', row));
          put(metrics, 'subscribers_lost', col(byDay, 'subscribersLost', row));
          put(metrics, 'minutes_watched', col(byDay, 'estimatedMinutesWatched', row));
        } else {
          (raw.errors ??= {}).analytics_day = `no analytics row for ${day} yet`;
        }
      }
    }
    if (raw.errors && Object.keys(raw).length === 1) throw new Error(`YouTube account: ${Object.values(raw.errors).join('; ')}`);
    return byDay ? { metrics, breakdowns: {}, raw } : { metrics, breakdowns: {}, raw, day: clock.today() };
  },

  /** The uploads playlist, newest first. A private Short is listed only through OAuth; a key sees the public ones. */
  async recent(): Promise<RecentPost[]> {
    const a = await auth();
    const who = channelParams(a);
    if (!who) throw new Error('YouTube: recent uploads need YOUTUBE_CHANNEL_ID with an API key, or a refresh token with youtube.readonly');
    const ch = await data<List<Channel>>('channels', { part: 'contentDetails', ...who });
    const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error('YouTube: the channel answer names no uploads playlist');
    const items = await data<List<PlaylistItem>>('playlistItems', { part: 'snippet,contentDetails', playlistId: uploads, maxResults: 50 });
    return (items.items ?? [])
      .filter((i) => i.contentDetails?.videoId)
      .map((i) => ({
        id: i.contentDetails!.videoId!,
        at: i.contentDetails?.videoPublishedAt ?? i.snippet?.publishedAt ?? '',
        text: `${i.snippet?.title ?? ''}\n${i.snippet?.description ?? ''}`,
      }))
      .sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  },

  async postedAt(id: string): Promise<string | undefined> {
    return (await video(id)).items?.[0]?.snippet?.publishedAt;
  },

  async parseId(urlOrId: string): Promise<string> {
    const s = urlOrId.trim();
    if (ID.test(s)) return s;
    const bad = () =>
      new Error(`not a YouTube video URL or id: "${s}" (expected youtu.be/<id>, youtube.com/watch?v=<id>, /shorts/<id>, /live/<id> or an 11-character id)`);
    let u: URL;
    try {
      u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
      throw bad();
    }
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    const seg = u.pathname.split('/').filter(Boolean);
    let id: string | undefined;
    if (host === 'youtu.be') id = seg[0];
    else if (host === 'youtube.com') {
      if (seg[0] === 'watch') id = u.searchParams.get('v') ?? undefined;
      else if (seg[0] === 'shorts' || seg[0] === 'live') id = seg[1];
    }
    if (!id || !ID.test(id)) throw bad();
    return id;
  },

  async token(): Promise<TokenState> {
    const keyNote = env('YOUTUBE_API_KEY') ? 'YOUTUBE_API_KEY is set' : 'YOUTUBE_API_KEY is unset';
    const o = needs(...OAUTH_VARS);
    const state: TokenState = { platform: 'youtube', configured: !!env('YOUTUBE_API_KEY') || o.ok };
    if (!o.ok) {
      state.note = `${keyNote}; no OAuth (${o.reason})`;
      return state;
    }
    const got = await oauthState();
    if (!got.token) {
      state.note = `${keyNote}; the OAuth token could not be fetched: ${got.error ?? 'no token'}`;
      return state;
    }
    state.scopes = got.scopes;
    const can = (
      [
        ['upload', UPLOAD],
        ['readonly', READ],
        ['analytics', ANALYTICS],
      ] as [string, string[]][]
    )
      .map(([name, names]) => (has(got.scopes, names) ? name : `no ${name}`))
      .join(', ');
    state.note = `refresh token has ${can}; ${keyNote}`;
    return state;
  },
};

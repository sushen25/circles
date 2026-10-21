/**
 * Bluesky, read through the public AppView. Every read here needs no token
 * (the probe on 21 October confirmed it; docs/analytics-plan.md, "What each
 * platform can give"), so `configured()` is always ok and the one setting is
 * BSKY_HANDLE, which names the account for the account row and the recent
 * feed. Bluesky reports no views: likes, reposts, replies and quotes are all
 * a post gives, and the headline number is `engagement` (metrics.ts).
 *
 * A post id is its AT URI (at://<did>/app.bsky.feed.post/<rkey>), what the
 * publisher writes into the ledger. `parseId` turns a pasted bsky.app link
 * into one, resolving the handle when the link carries one instead of a did.
 *
 * Privacy, kept here because nothing downstream can check it: `replies()`
 * returns id, time and text and nothing else, drops the account's own
 * replies by did, and never returns the thread itself; `recent()` and
 * `account()` return counts and the account's own post text. The getPosts
 * answer stored as `raw` can name another person: a quote post carries the
 * quoted author (did, handle, displayName, avatar) under `embed`, nested
 * once more when the quote comes with media, and a mention facet carries
 * a did. Before raw leaves metrics(), every author block below the post's
 * own loses those four fields, and every did that is not the account's own
 * is blanked wherever it appears (a quoted post's uri, a mention facet, a
 * CDN link); the post's own author block stays, as every post view carries
 * it, and nothing else is trimmed. BSKY_APP_PASSWORD, which the publisher
 * needs, is never read here.
 */
import { dateOf, type Metrics, type Reply } from '../metrics.ts';
import { env, NotConfigured, type AccountFetched, type Configured, type Fetched, type PlatformModule, type RecentPost, type TokenState } from './module.ts';
import { getJson, HttpError, withQuery } from './http.ts';

export const BSKY_API = 'https://public.api.bsky.app/xrpc';

/** The parts of a post view this module reads; the AppView returns more, and raw keeps all of it. */
type PostView = {
  uri: string;
  author?: { did?: string };
  record?: { text?: string; createdAt?: string };
  indexedAt?: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
  /** a save */
  bookmarkCount?: number;
};
type GetPosts = { posts?: PostView[] };
/** A thread node: a post with its replies, or a blocked / not-found placeholder that carries no `post`. */
type ThreadNode = { post?: PostView; replies?: ThreadNode[] };
type GetPostThread = { thread?: ThreadNode };
type Profile = { followersCount?: number; followsCount?: number; postsCount?: number };
/** A feed item carries `reason` when it is a repost by the account; the post is then someone else's. */
type AuthorFeed = { feed?: { post?: PostView; reason?: unknown }[] };
type ResolveHandle = { did?: string };

const AT_POST = /^at:\/\/[^/\s]+\/app\.bsky\.feed\.post\/[^/?#\s]+$/;
const POST_URL = /^(?:https?:\/\/)?(?:www\.)?bsky\.app\/profile\/([^/?#\s]+)\/post\/([^/?#\s]+)/i;

const xrpc = (method: string, params: Record<string, string | number | undefined>) => withQuery(`${BSKY_API}/${method}`, params);

/** The account, for the calls that need one. Only `account()` and `recent()` do; without it they throw NotConfigured, which the pull logs as a skip. */
function actor(): string {
  const h = env('BSKY_HANDLE');
  if (!h) throw new NotConfigured('bluesky: BSKY_HANDLE unset; the account row and the recent feed need the account');
  return h;
}

/** The post's own time: what the client wrote, or when the AppView saw it. */
const timeOf = (p: PostView): string | undefined => p.record?.createdAt ?? p.indexedAt;

/** A did wherever it sits in a string: did:plc:…, did:web:… */
const DID = /did:[a-z]+:[A-Za-z0-9._%:-]*[A-Za-z0-9]/g;
/** What a profile view carries that names its person. */
const PERSON = new Set(['did', 'handle', 'displayName', 'avatar']);

/**
 * The post view with every person but the account blanked (see the header).
 * An author block below the post's own loses its person fields, and a did
 * other than the account's is blanked in any string, so a quoted post's uri
 * and a mention facet go with the author block. The post's own author
 * block is kept whole; its did is what "the account's own" means here.
 */
function scrubOthers(post: PostView): PostView {
  const own = post.author?.did;
  const walk = (v: unknown, inAuthor = false): unknown => {
    if (typeof v === 'string') return v.replace(DID, (d) => (d === own ? d : '…'));
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inAuthor && PERSON.has(k) ? '…' : walk(x, k === 'author')]));
    }
    return v;
  };
  const { author, ...rest } = post;
  return { ...(walk(rest) as Omit<PostView, 'author'>), ...(author ? { author } : {}) };
}

async function getPost(uri: string): Promise<{ post: PostView | undefined; raw: GetPosts }> {
  const raw = await getJson<GetPosts>(xrpc('app.bsky.feed.getPosts', { uris: uri }));
  return { post: raw.posts?.[0], raw };
}

export const bluesky: PlatformModule = {
  platform: 'bluesky',

  /** Public reads need nothing; BSKY_HANDLE is checked by the two calls that use it. */
  configured(): Configured {
    return { ok: true };
  },

  async metrics(id: string): Promise<Fetched> {
    const { post, raw } = await getPost(id);
    if (!post) throw new Error(`bluesky: no post at ${id} (deleted, or not a post uri)`);
    const metrics: Metrics = {};
    if (typeof post.likeCount === 'number') metrics.likes = post.likeCount;
    if (typeof post.repostCount === 'number') metrics.reposts = post.repostCount;
    if (typeof post.replyCount === 'number') metrics.replies = post.replyCount;
    if (typeof post.quoteCount === 'number') metrics.quotes = post.quoteCount;
    if (typeof post.bookmarkCount === 'number') metrics.saves = post.bookmarkCount;
    return { metrics, raw: { ...raw, posts: (raw.posts ?? []).map(scrubOthers) } };
  },

  /**
   * Every reply at every depth of the thread, flattened in thread order.
   * A reply by the root post's author is dropped but its children are kept:
   * the account answering someone, and that someone answering back, is a
   * reply by someone else. A placeholder (blocked, not found) has no post
   * and no children. A reply with no time at all cannot be aged and is
   * skipped; the AppView always gives `indexedAt`, so none is expected.
   */
  async replies(id: string, since?: string): Promise<Reply[]> {
    const raw = await getJson<GetPostThread>(xrpc('app.bsky.feed.getPostThread', { uri: id, depth: 10 }));
    const root = raw.thread?.post;
    if (!root) throw new Error(`bluesky: the thread at ${id} is not readable (blocked, or not found)`);
    const ownDid = root.author?.did;
    const sinceMs = since ? Date.parse(since) : Number.NaN;
    const out: Reply[] = [];
    const walk = (nodes: ThreadNode[] | undefined) => {
      for (const node of nodes ?? []) {
        const p = node.post;
        if (!p) continue;
        const at = timeOf(p);
        const own = ownDid !== undefined && p.author?.did === ownDid;
        const old = at !== undefined && Number.isFinite(sinceMs) && Date.parse(at) < sinceMs;
        if (!own && !old && at) out.push({ id: p.uri, at, text: p.record?.text ?? '' });
        walk(node.replies);
      }
    };
    walk(raw.thread?.replies);
    return out;
  },

  /**
   * The profile's three counts. Bluesky has no by-day endpoint: the counts
   * are read as they stand at pull time, so the row is today's whatever
   * day was asked for, and `day` says so.
   */
  async account(_day: string): Promise<AccountFetched> {
    const profile = await getJson<Profile>(xrpc('app.bsky.actor.getProfile', { actor: actor() }));
    const metrics: Record<string, number> = {};
    if (typeof profile.followersCount === 'number') metrics.followers = profile.followersCount;
    if (typeof profile.followsCount === 'number') metrics.follows = profile.followsCount;
    if (typeof profile.postsCount === 'number') metrics.posts = profile.postsCount;
    return { metrics, breakdowns: {}, raw: { profile }, day: dateOf(new Date()) };
  },

  /** The account's last fifty posts, replies and reposts left out, newest first. */
  async recent(): Promise<RecentPost[]> {
    const raw = await getJson<AuthorFeed>(xrpc('app.bsky.feed.getAuthorFeed', { actor: actor(), limit: 50, filter: 'posts_no_replies' }));
    const posts: RecentPost[] = [];
    for (const item of raw.feed ?? []) {
      const p = item.post;
      if (!p || item.reason) continue;
      const at = timeOf(p);
      if (!at) continue;
      posts.push({ id: p.uri, at, text: p.record?.text ?? '' });
    }
    return posts.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  },

  async postedAt(id: string): Promise<string | undefined> {
    const { post } = await getPost(id);
    return post ? timeOf(post) : undefined;
  },

  /**
   * An at:// post uri passes through. A bsky.app link names the account by
   * did or by handle; a handle is resolved to its did, since the ledger
   * holds dids and a handle can change. Anything else is refused by name.
   */
  async parseId(urlOrId: string): Promise<string> {
    const s = urlOrId.trim();
    if (s.startsWith('at://')) {
      if (AT_POST.test(s)) return s;
      throw new Error(`bluesky: "${s}" is not a post uri; expected at://<did>/app.bsky.feed.post/<rkey>`);
    }
    const m = s.match(POST_URL);
    if (!m) throw new Error(`bluesky: cannot read a post id from "${s}"; paste the bsky.app/profile/…/post/… link or the at:// uri`);
    const [, who, rkey] = m;
    if (who.startsWith('did:')) return `at://${who}/app.bsky.feed.post/${rkey}`;
    let did: string | undefined;
    try {
      did = (await getJson<ResolveHandle>(xrpc('com.atproto.identity.resolveHandle', { handle: who }))).did;
    } catch (e) {
      // The handle is left out: it is in the pasted link already, and the status is what helps.
      const status = e instanceof HttpError ? ` (${e.status})` : '';
      throw new Error(`bluesky: could not resolve the handle in the pasted link${status}`);
    }
    if (!did) throw new Error('bluesky: the handle in the pasted link resolved to no did');
    return `at://${did}/app.bsky.feed.post/${rkey}`;
  },

  /** Nothing to expire. The note says whether the account row can be pulled, never the handle itself. */
  async token(): Promise<TokenState> {
    return {
      platform: 'bluesky',
      configured: true,
      note: `public reads need no token; BSKY_HANDLE is ${env('BSKY_HANDLE') ? 'set' : 'unset'} for the account row`,
    };
  },
};

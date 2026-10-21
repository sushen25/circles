/**
 * What a piece is, measured from its queue file (docs/analytics-plan.md,
 * "Content features"): one row per piece in analytics/features.jsonl, the
 * data the scorecard splits on and the drafting skills can act on.
 *
 * Two kinds of feature. The pure ones come from the JSON, the frontmatter,
 * the captions and the ledger, with no browser. The timed ones (total,
 * before, after, per slide) are measured by building the skit in Chromium;
 * `timingOf` turns that build into numbers, `npm run check` applies its
 * rules to them, and `npm run video` writes them into the file's
 * frontmatter as `timing:` so the nightly pull never needs a browser.
 *
 *   npm run measure queue/2026-10-20-never-lead-anywhere.md            # print the row
 *   npm run measure -- --timing queue/2026-10-20-never-lead-anywhere.md # build it, write timing:, print
 */
import type { Caption, Platform, QueueItem } from './queue.ts';

/** A slide as the measures read it: any component, its props loose. */
type AnySlide = { type: string; screen?: string; messages?: { from?: string; text?: string; link?: unknown }[]; [k: string]: unknown };

/** The slide's token in the shape grammar (check.ts): a screen by its name, a chat carrying the share link as `chatlink`. */
export const token = (s: AnySlide): string =>
  s.type === 'screen' ? String(s.screen) : s.type === 'chat' && s.messages?.some((m) => m.link) ? 'chatlink' : s.type;

/** The "after": the product on screen. Everything else is the "before". */
export const AFTER: ReadonlySet<string> = new Set(['chatlink', 'availability', 'locked', 'grid', 'compare', 'end']);

/** Slides that are a conversation, and so count as a chat before the beat. */
const CHATTY = new Set(['chat', 'chatlink', 'poll', 'dm', 'notification']);

export type Timing = {
  /** seconds, the whole video */
  total: number;
  /** seconds before the product is on screen, the end card excluded */
  before: number;
  /** seconds with the product on screen, the end card excluded */
  after: number;
  /** seconds per slide, in order */
  slides: number[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The timed features from a build's scenes (render/browser.ts): one source for check's rules and the feature row. */
export function timingOf(scenes: { start: number; end: number }[], tokens: string[], total: number): Timing {
  let before = 0;
  let after = 0;
  scenes.forEach((sc, i) => {
    if (tokens[i] === 'end') return;
    if (AFTER.has(tokens[i])) after += sc.end - sc.start;
    else before += sc.end - sc.start;
  });
  return { total: r2(total), before: r2(before), after: r2(after), slides: scenes.map((sc) => r2(sc.end - sc.start)) };
}

/** The `timing:` block the video build wrote into the frontmatter, or undefined when there is none or it does not read. */
export function readTiming(fm: Record<string, unknown>): Timing | undefined {
  const t = fm.timing as Record<string, string> | undefined;
  if (!t || typeof t !== 'object') return undefined;
  const total = Number(t.total);
  const before = Number(t.before);
  const after = Number(t.after);
  const slides = String(t.slides ?? '').split(/\s+/).filter(Boolean).map(Number);
  if (![total, before, after, ...slides].every(Number.isFinite) || total <= 0) return undefined;
  return { total, before, after, slides };
}

/** Write (or replace) the `timing:` block in a queue file's raw text, leaving everything else as it was. */
export function setTiming(raw: string, t: Timing): string {
  const block = `timing:\n  total: ${t.total.toFixed(2)}\n  before: ${t.before.toFixed(2)}\n  after: ${t.after.toFixed(2)}\n  slides: ${t.slides.map((s) => s.toFixed(2)).join(' ')}\n`;
  // Only the frontmatter is touched: a body line that happens to start `timing:` is the piece's text, not this block.
  const fm = raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!fm) throw new Error('queue file has no frontmatter');
  const head = fm[0];
  const existing = /^timing:[ \t]*\r?\n(?:[ \t]+\S.*(?:\r?\n|$))*/m;
  const next = existing.test(head) ? head.replace(existing, () => block) : head.replace(/\r?\n---(\r?\n|$)$/, (m) => `\n${block}${m.replace(/^\r?\n/, '')}`);
  return next + raw.slice(head.length);
}

const MELBOURNE = 'Australia/Melbourne';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** An instant's hour (0–23) and weekday in Melbourne: the posting windows are read in the audience's time. */
export function melbourne(iso: string): { hour: number; weekday: string } | undefined {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: MELBOURNE, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(t));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  return { hour, weekday: WEEKDAYS.find((d) => wd.startsWith(d)) ?? wd };
}

/** The calendar day in Melbourne, YYYY-MM-DD: how the scorecard and the brief are dated. */
export const melbourneDate = (at: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: MELBOURNE }).format(at);

export type CaptionFeatures = {
  length: number;
  sentences: number;
  question: boolean;
  link: boolean;
  hashtags: number;
  /** youtube: the Short's title line */
  title_length?: number;
};

export type FeatureRow = {
  slug: string;
  /** ISO time the row was measured */
  at: string;
  family: string;
  shape?: string;
  archetype?: string;
  hook: { text: string; words: number; number: boolean; quote: boolean; time: boolean };
  slides: number;
  /** count of each slide token (a split's two sides counted inside it) */
  components: Record<string, number>;
  chats_before_beat: number;
  messages: { total: number; per_chat: number[]; median_len: number };
  when_stamps: number;
  skip: boolean;
  /** 1-based slides that use `pace: slow` */
  slow_pace: number[];
  /** slides carrying a `caption` aside */
  captions: number;
  me?: string;
  cast: number;
  screens: { availability: boolean; locked: boolean; compare: boolean; grid: boolean };
  /** where the quote slide's phrase came from */
  quote_source?: 'subreddit' | 'dms' | 'comments' | 'other';
  platforms: Partial<Record<Platform, CaptionFeatures>>;
  /** the frontmatter's publish_at, in Melbourne */
  publish_at?: { hour: number; weekday: string };
  /** when each platform's post actually went out, in Melbourne, from the ledger */
  posted: Partial<Record<Platform, { hour: number; weekday: string }>>;
  /** from the `timing:` block; absent until the video build has measured it */
  timing?: Timing;
};

const NUMBER = /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|hundred|dozen)\b/i;
const TIME = /\b\d{1,2}(?::\d\d)?\s?(?:am|pm)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|tomorrow|weekend|week|weeks|month|months|year|years|ages|o'clock)\b/i;
const QUOTED = /^["“'‘]/;

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** A slide and, for a split, its two sides: the slides a viewer actually reads. */
const leaves = (s: AnySlide): AnySlide[] => (s.type === 'split' ? [s.left as AnySlide, s.right as AnySlide].filter(Boolean).flatMap(leaves) : [s]);

/** The lines of a conversation slide: chat and dm messages, a poll's follow-ups, a notification's items. */
function lines(s: AnySlide): { from?: string; text?: string }[] {
  if (Array.isArray(s.messages)) return s.messages;
  if (s.type === 'poll' && Array.isArray(s.after)) return s.after as { from?: string; text?: string }[];
  if (s.type === 'notification' && Array.isArray(s.items)) return s.items as { from?: string; text?: string }[];
  return [];
}

function captionFeatures(platform: Platform, c: Caption): CaptionFeatures {
  const text = c.text.trim();
  const inline = text.match(/(^|\s)#\w+/g)?.length ?? 0;
  return {
    length: text.length,
    sentences: text.split(/[.?!…]+(?:\s+|$)/).filter((x) => x.trim()).length,
    question: /\?["”’)]*$/.test(text),
    link: /\bwenna\.app\b/i.test(text),
    hashtags: c.hashtags.length + inline,
    ...(platform === 'youtube' && c.title ? { title_length: c.title.length } : {}),
  };
}

function quoteSource(source: unknown): FeatureRow['quote_source'] {
  const s = String(source ?? '');
  if (/(^|\s)r\//i.test(s)) return 'subreddit';
  if (/\bdms?\b|direct message/i.test(s)) return 'dms';
  if (/comment/i.test(s)) return 'comments';
  return 'other';
}

export type LedgerLine = { platform: string; slug: string; at: string; kind?: string };

/** The pure features of one queue file. `now` stamps the row; the ledger gives each platform's actual post time. */
export function measure(item: QueueItem, ledger: LedgerLine[], now: Date): FeatureRow {
  if (!item.skit) throw new Error(`${item.path}: no \`\`\`json slideshow block`);
  const slides = item.skit.slides as unknown as AnySlide[];
  const tokens = slides.map(token);
  const hook = String(item.fm.hook ?? item.skit.hook ?? '').trim();

  const components: Record<string, number> = {};
  for (const s of slides) {
    const t = token(s);
    components[t] = (components[t] ?? 0) + 1;
    if (s.type === 'split') for (const l of leaves(s)) components[token(l)] = (components[token(l)] ?? 0) + 1;
  }

  const beat = tokens.indexOf('beat');
  const beforeBeat = beat < 0 ? slides : slides.slice(0, beat);
  const chats_before_beat = beforeBeat.flatMap(leaves).filter((s) => CHATTY.has(token(s))).length;

  const chats = slides.flatMap(leaves).filter((s) => CHATTY.has(token(s)));
  const all = chats.flatMap(lines);
  const cast = new Set<string>();
  for (const s of chats) {
    for (const m of lines(s)) if (m.from) cast.add(m.from);
    if (s.type === 'dm') for (const k of ['a', 'b']) if (typeof s[k] === 'string') cast.add(s[k] as string);
  }

  const platforms: FeatureRow['platforms'] = {};
  for (const [p, c] of Object.entries(item.captions) as [Platform, Caption][]) platforms[p] = captionFeatures(p, c);

  const posted: FeatureRow['posted'] = {};
  for (const l of ledger) {
    if (l.slug !== item.fm.slug || l.kind === 'drafted') continue;
    const p = l.platform as Platform;
    if (posted[p]) continue;
    const m = melbourne(l.at);
    if (m) posted[p] = m;
  }

  const quote = slides.find((s) => s.type === 'quote');
  const timing = readTiming(item.fm as unknown as Record<string, unknown>);
  const publishAt = item.fm.publish_at ? melbourne(String(item.fm.publish_at)) : undefined;
  const words = hook.replace(/["“”‘’]/g, '').split(/\s+/).filter(Boolean).length;

  return {
    slug: item.fm.slug,
    at: now.toISOString(),
    family: item.fm.family,
    ...(item.fm.shape ? { shape: item.fm.shape } : {}),
    ...(item.fm.archetype ? { archetype: item.fm.archetype } : {}),
    hook: { text: hook, words, number: NUMBER.test(hook), quote: QUOTED.test(hook) || item.fm.archetype === 'quote', time: TIME.test(hook) },
    slides: slides.length,
    components,
    chats_before_beat,
    messages: {
      total: all.length,
      per_chat: chats.map((s) => lines(s).length),
      median_len: median(all.map((m) => String(m.text ?? '').length)),
    },
    when_stamps: slides.flatMap(leaves).filter((s) => typeof s.when === 'string').length,
    skip: tokens.includes('skip'),
    slow_pace: slides.flatMap((s, i) => (leaves(s).some((l) => l.pace === 'slow') ? [i + 1] : [])),
    captions: slides.filter((s) => s.type !== 'grid' && 'caption' in s).length,
    ...(item.skit.me ? { me: item.skit.me } : {}),
    cast: cast.size,
    screens: {
      availability: tokens.includes('availability'),
      locked: tokens.includes('locked'),
      compare: tokens.includes('compare'),
      grid: tokens.includes('grid'),
    },
    ...(quote ? { quote_source: quoteSource(quote.source) } : {}),
    platforms,
    ...(publishAt ? { publish_at: publishAt } : {}),
    posted,
    ...(timing ? { timing } : {}),
  };
}

/** Whether two rows describe the same piece the same way; `at` is when, not what. */
export function sameFeatures(a: FeatureRow, b: FeatureRow): boolean {
  const strip = ({ at: _at, ...rest }: FeatureRow) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

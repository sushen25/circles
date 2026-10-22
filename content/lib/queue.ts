/**
 * A queue file is markdown: YAML-ish frontmatter, one ```json block (the
 * slideshow), and `## <platform>` sections whose blockquote is the caption.
 * Deliberately no YAML library: the frontmatter is flat strings, lists and
 * ISO dates, and a hand parser keeps the repo at zero build steps.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

export type Platform = 'tiktok' | 'instagram' | 'threads' | 'bluesky' | 'linkedin' | 'youtube' | 'reddit';

/** Every platform a piece gets a caption for, in the order the skit skill writes them. */
export const ALL_PLATFORMS: Platform[] = ['tiktok', 'instagram', 'threads', 'bluesky', 'linkedin', 'youtube'];

/** Per-platform caption limits, checked by /review and the publisher. */
export const CAPTION_LIMIT: Record<Platform, number> = {
  tiktok: 150,
  instagram: 300,
  threads: 500,
  bluesky: 300,
  linkedin: 1200,
  youtube: 100,
  reddit: 10_000,
};

export type Frontmatter = {
  slug: string;
  date: string;
  family: string;
  hook: string;
  archetype?: string;
  /** The story shape from the skit skill (skit, quote-led, side-chat, drift, tetris, demo-first). */
  shape?: string;
  status: 'draft' | 'approved' | 'needs-human' | 'published' | string;
  platforms: Platform[];
  publish_at: string;
  publish_window_minutes: number;
  media: 'slideshow' | 'none' | string;
  /** Per-platform post ids written back after publishing. */
  published?: Record<string, string>;
  /** Seconds as the video build measured them (lib/measure.ts setTiming): total, before, after, slides. */
  timing?: Record<string, string>;
};

/**
 * A convenience type for publish/ and analytics/. The source of truth for
 * what a slide may contain is each component's schema() in
 * render/components/ (run `npm run check`); keep this union in step with it.
 */
export type Slide =
  | { type: 'cover'; line1: string; line2?: string }
  | {
      type: 'chat';
      title: string;
      when?: string;
      pace?: 'slow' | 'normal' | 'fast';
      messages: { from: string; text: string; link?: { url: string; title: string; sub?: string; domain?: string } }[];
    }
  | { type: 'beat'; line: string }
  | {
      type: 'screen';
      screen: 'availability' | 'locked';
      lead?: string;
      plan?: string;
      title?: string;
      sub?: string;
      start?: number;
      picks?: { day: number; when?: string; label: string; time?: string }[];
      sentLine?: string;
      sentSub?: string;
      circle?: string;
      date?: string;
      time?: string;
      place?: string;
      area?: string;
      people?: string[];
      going?: string;
      quote?: string;
    }
  | { type: 'compare'; beforeLabel?: string; before: string[]; afterLabel?: string; after: string[] }
  | { type: 'grid'; caption: string; days: string[]; picked: string[]; note?: string }
  | { type: 'end'; line: string; url: string }
  | { type: 'quote'; text: string; source: string }
  | { type: 'count'; lines: { n: string; of: string }[] }
  | { type: 'skip'; line: string; sub?: string }
  | { type: 'dm'; a: string; b: string; when?: string; pace?: 'slow' | 'normal' | 'fast'; messages: { from: string; text: string }[] }
  | { type: 'split'; left: Slide; right: Slide; order?: 'sequence' }
  | { type: 'notification'; when?: string; items: { group: string; from: string; text: string; time: string }[] }
  | {
      type: 'poll';
      title: string;
      when?: string;
      asked: string;
      question: string;
      options: { label: string; votes: string[] }[];
      after?: { from: string; text: string }[];
    }
  | {
      type: 'calendar';
      title?: string;
      start: number;
      month?: string;
      days?: 7 | 14;
      firstDow?: number;
      people: { name: string; busy: number[] }[];
      note?: string;
    };

/** Any slide except `end` and `grid` may also carry `caption`: a first-person line in the viewer's character. */
export type Captioned<S> = S & { caption?: string };

/** `me` names the speaker shown as the viewer (right-aligned, accent) in video. */
export type Skit = { hook: string; me?: string; slides: Slide[] };

export type Caption = { text: string; hashtags: string[]; /** youtube only: the Short's title line */ title?: string };

export type QueueItem = {
  path: string;
  raw: string;
  fm: Frontmatter;
  skit: Skit | null;
  captions: Partial<Record<Platform, Caption>>;
};

function parseScalar(v: string): unknown {
  const t = v.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    return t
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  return t.replace(/^["']|["']$/g, '');
}

/** A nested map's value, as text with its surrounding quotes removed: post ids, and an Instagram id is above 2^53, which Number() would round. */
const unquote = (v: string): string => v.trim().replace(/^(["'])(.*)\1$/, '$2');

export function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('queue file has no frontmatter');
  const fm: Record<string, unknown> = {};
  let currentMap: Record<string, string> | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const nested = line.match(/^\s{2,}([\w-]+):\s*(.*)$/);
    if (nested && currentMap) {
      currentMap[nested[1]] = unquote(nested[2]);
      continue;
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (v.trim() === '') {
      currentMap = {};
      fm[k] = currentMap;
    } else {
      currentMap = null;
      fm[k] = parseScalar(v);
    }
  }
  return { fm, body: m[2] };
}

export function parseQueueFile(path: string): QueueItem {
  const raw = readFileSync(path, 'utf8');
  const { fm, body } = parseFrontmatter(raw);

  const json = body.match(/```json\s*\n([\s\S]*?)\n```/);
  const skit = json ? (JSON.parse(json[1]) as Skit) : null;

  const captions: Partial<Record<Platform, Caption>> = {};
  const sections = body.split(/^## /m).slice(1);
  for (const s of sections) {
    const [head, ...rest] = s.split('\n');
    const name = head.trim().toLowerCase() as Platform;
    const text = rest
      .filter((l) => l.startsWith('>'))
      .map((l) => l.replace(/^>\s?/, ''))
      .join('\n')
      .trim();
    const titleLine = rest.find((l) => l.startsWith('title:'));
    const title = titleLine ? titleLine.replace('title:', '').trim() : undefined;
    const tags = rest.find((l) => l.startsWith('hashtags:'));
    const hashtags = tags
      ? tags
          .replace('hashtags:', '')
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => t.startsWith('#'))
      : [];
    if (text) captions[name] = { text, hashtags, ...(title ? { title } : {}) };
  }

  const f = fm as Partial<Frontmatter>;
  if (!f.slug) f.slug = basename(path).replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  if (!f.status) f.status = 'draft';
  if (!f.platforms) f.platforms = [];
  if (!f.publish_window_minutes) f.publish_window_minutes = 0;

  return { path, raw, fm: f as Frontmatter, skit, captions };
}

export function listQueue(dir = 'queue'): QueueItem[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseQueueFile(join(dir, f)));
}

/** Rewrite one frontmatter key in the raw file text, preserving everything else. */
export function setFrontmatterKey(raw: string, key: string, value: string): string {
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (re.test(raw)) return raw.replace(re, `${key}: ${value}`);
  return raw.replace(/^---\r?\n/, `---\n${key}: ${value}\n`);
}

/** Append `published:` map entries (platform: id) to the frontmatter. */
export function addPublishedIds(raw: string, ids: Record<string, string>): string {
  const lines = Object.entries(ids).map(([k, v]) => `  ${k}: "${v}"`);
  if (/^published:\s*$/m.test(raw)) {
    return raw.replace(/^published:\s*$/m, `published:\n${lines.join('\n')}`);
  }
  return raw.replace(/\r?\n---\r?\n/, `\npublished:\n${lines.join('\n')}\n---\n`);
}

/**
 * Rewrite one platform's line inside the `published:` block, or add it when
 * there is none. The publisher leaves a TikTok draft's publish_id here; the
 * founder's claim of the posted video replaces it (analytics/claim.ts).
 */
export function setPublishedId(raw: string, platform: string, id: string): string {
  // The block runs to the next unindented line, blank lines included, as parseFrontmatter reads it; the blank lines at
  // its end are given back before the splice, so only the entries are rewritten.
  const block = raw.match(/^published:[ \t]*\r?\n((?:(?:[ \t]+\S.*|[ \t]*)(?:\r?\n|$))*)/m);
  const line = new RegExp(`^[ \\t]+${platform}:.*$`, 'm');
  if (!block) return addPublishedIds(raw, { [platform]: id });
  const entries = block[1].replace(/(\r?\n)(?:[ \t]*\r?\n)+$/, '$1');
  if (!line.test(entries)) return addPublishedIds(raw, { [platform]: id });
  const start = block.index! + block[0].length - block[1].length;
  return raw.slice(0, start) + entries.replace(line, () => `  ${platform}: "${id}"`) + raw.slice(start + entries.length);
}

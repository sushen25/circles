/**
 * New replies go to inbox/<date>-replies.md, one section per piece and
 * platform, one blockquote per reply, for /mine to lift phrases from
 * (docs/analytics-plan.md, "Replies"; the format is what
 * .claude/skills/mine/SKILL.md reads). Each reply is written once: the
 * sha256 of its `<platform>:<id>` (hex, the first 32 characters) goes into
 * analytics/replies-seen.json and a reply whose hash is there is skipped.
 * The file holds hashes, never ids, because a Bluesky reply id is
 * `at://<the replier's did>/…` and would name the person. Handles and
 * links are stripped on the way in, even though the modules already drop
 * authors, so nothing that names a person reaches the file. Nothing is
 * written when nothing is new: no empty file, no empty section, and the
 * seen set is left alone.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Platform } from '../lib/queue.ts';
import { stripHandles, type Reply } from './metrics.ts';

export type ReplyEntry = { slug: string; platform: Platform; replies: Reply[] };

/** The seen set's entry for a reply: a hash of `<platform>:<id>`, so the file names no one. */
export const seenKey = (platform: Platform, id: string): string => createHash('sha256').update(`${platform}:${id}`).digest('hex').slice(0, 32);

function readSeen(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a JSON array`);
  return new Set(parsed.map(String));
}

/** A reply as a blockquote: every line prefixed, an empty line as a bare `>`. */
function blockquote(text: string): string {
  return stripHandles(text)
    .split(/\r?\n/)
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n');
}

export function writeReplies(
  date: string,
  entries: ReplyEntry[],
  opts = { seenPath: 'analytics/replies-seen.json', inboxDir: 'inbox' },
): { written: number; file: string } {
  const file = join(opts.inboxDir, `${date}-replies.md`);
  const seen = readSeen(opts.seenPath);
  const sections: string[] = [];
  let written = 0;

  for (const entry of entries) {
    const fresh: Reply[] = [];
    for (const r of entry.replies) {
      const key = seenKey(entry.platform, r.id);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(r);
    }
    if (!fresh.length) continue;
    fresh.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    sections.push(`## ${entry.slug} · ${entry.platform}\n\n${fresh.map((r) => blockquote(r.text)).join('\n\n')}\n`);
    written += fresh.length;
  }
  if (!written) return { written: 0, file };

  mkdirSync(opts.inboxDir, { recursive: true });
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  const body = sections.join('\n');
  if (existing === undefined) writeFileSync(file, `# Replies, ${date}\n\n${body}`);
  else writeFileSync(file, `${existing}${existing.endsWith('\n') ? '' : '\n'}\n${body}`);

  mkdirSync(dirname(opts.seenPath), { recursive: true });
  writeFileSync(opts.seenPath, JSON.stringify([...seen].sort(), null, 2) + '\n');
  return { written, file };
}

/**
 * Claim a post the founder made by hand, so the pull can measure it.
 *
 *   npm run posted <platform> <slug> <url-or-id> [--at <iso>] [--dry]
 *
 * TikTok is always posted by hand (the script only drafts, ADR 0086), a
 * Short is claimed here when the pull's auto-claim found no tag in its
 * description, and Reddit has no module at all, so the URL is the id. The
 * platform module turns a pasted URL into the id the ledger holds
 * (`parseId`) and asks the platform when the post went out (`postedAt`);
 * without either, the argument is the id and the time is now, and the
 * command says so. The write itself is `claim()` in claim.ts, the same
 * function auto-claim uses: a `published:` entry in the queue file and a
 * ledger row marked `by: hand`. For a TikTok draft the publisher sent, the
 * entry holds the draft's publish_id until this command replaces it with
 * the video id, and the line printed says so.
 *
 * `run(args, deps)` is exported with the real modules as defaults so the
 * test can hand it fakes; the defaults are loaded lazily, so this file
 * loads even before the registry does.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceRef } from '../lib/links.ts';
import { CAPTION_LIMIT, type Platform, type QueueItem } from '../lib/queue.ts';
import { DRAFT_ONLY, SCRIPTABLE, type Ledger } from '../publish/guards.ts';
// Type only, so claim.ts is still loaded lazily (see realDeps).
import type { ClaimResult } from './claim.ts';
import type { PlatformModule } from './platforms/module.ts';

export const PLATFORMS = Object.keys(CAPTION_LIMIT) as Platform[];

export const USAGE = `usage: npm run posted <platform> <slug> <url-or-id> [--at <iso>] [--dry]

  platform   one of ${PLATFORMS.join(', ')}
  slug       the piece, as in its queue file's frontmatter
  url-or-id  the post's URL as pasted from the app, or its id
  --at       when it went out (ISO); else the platform is asked, else now
  --dry      print what would be written and write nothing`;

/** What claim.ts returns: whether the file moved to published/, where it is now, the tag, and the draft id it replaced, if any. */
export type { ClaimResult };

export type Deps = {
  moduleFor: (platform: Platform) => PlatformModule | undefined;
  findItem: (slug: string) => QueueItem | undefined;
  claim: (item: QueueItem, platform: Platform, id: string, at: string) => ClaimResult | Promise<ClaimResult>;
  now: () => Date;
  log: (line: string) => void;
  error: (line: string) => void;
};

async function realDeps(): Promise<Pick<Deps, 'moduleFor' | 'findItem' | 'claim'>> {
  const [registry, claiming] = await Promise.all([import('./platforms/index.ts'), import('./claim.ts')]);
  return { moduleFor: registry.moduleFor, findItem: claiming.findItem, claim: claiming.claim };
}

async function withDefaults(deps: Partial<Deps>): Promise<Deps> {
  const real = deps.moduleFor && deps.findItem && deps.claim ? {} : await realDeps();
  return { now: () => new Date(), log: console.log, error: console.error, ...real, ...deps } as Deps;
}

export type Args = { platform: Platform; slug: string; urlOrId: string; at?: string; dry: boolean };

/** Positional platform, slug, url-or-id; `--at <iso>`; `--dry`. Returns a string, the reason, when the call is wrong. */
export function parseArgs(argv: string[]): Args | string {
  const positional: string[] = [];
  let at: string | undefined;
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') dry = true;
    else if (a === '--at') {
      at = argv[++i];
      if (!at) return '--at needs an ISO time';
    } else if (a.startsWith('--')) return `unknown flag ${a}`;
    else positional.push(a);
  }
  if (positional.length !== 3) return 'expected <platform> <slug> <url-or-id>';
  const [platform, slug, urlOrId] = positional;
  if (!PLATFORMS.includes(platform as Platform)) return `"${platform}" is not a platform; one of ${PLATFORMS.join(', ')}`;
  if (at !== undefined && Number.isNaN(Date.parse(at))) return `--at "${at}" is not a date`;
  return { platform: platform as Platform, slug, urlOrId, at, dry };
}

/** Whether the file would leave queue/ once this platform is in: every scriptable platform it was drafted for has an id. */
export function wouldMove(item: QueueItem, platform: Platform): boolean {
  return (item.fm.platforms ?? []).filter((p) => SCRIPTABLE.has(p)).every((p) => p === platform || !!item.fm.published?.[p]);
}

/** Exit code: 0 claimed (or dry), 1 a failure, 2 a wrong call. */
export async function run(argv: string[], deps: Partial<Deps> = {}): Promise<number> {
  const parsed = parseArgs(argv);
  const d = await withDefaults(deps);
  if (typeof parsed === 'string') {
    d.error(`${parsed}\n\n${USAGE}`);
    return 2;
  }
  const { platform, slug, urlOrId, dry } = parsed;

  const item = d.findItem(slug);
  if (!item) {
    d.error(`no queue or published file has slug "${slug}"`);
    return 1;
  }
  const module = d.moduleFor(platform);

  let id = urlOrId;
  if (module?.parseId) {
    try {
      id = await module.parseId(urlOrId);
    } catch (e) {
      d.error(`${platform}: cannot read an id from "${urlOrId}": ${(e as Error).message}`);
      return 1;
    }
  }

  let at = parsed.at ? new Date(parsed.at).toISOString() : undefined;
  if (!at && module?.postedAt) {
    try {
      at = await module.postedAt(id);
    } catch (e) {
      d.log(`note  ${platform} could not say when ${id} was posted: ${(e as Error).message}`);
    }
  }
  if (!at) {
    at = d.now().toISOString();
    d.log(`note  no --at and ${platform} cannot say when it was posted; recording now (${at}), so its age will read low`);
  }

  // The row as claim.ts writes it: a hand claim is a post, TikTok included; "drafted" is the publisher's.
  const from = sourceRef(platform, item.fm.slug);
  const row: Ledger[number] = { date: at.slice(0, 10), platform, slug: item.fm.slug, id, at, from, kind: 'posted', by: 'hand' };
  const already = item.fm.published?.[platform];
  if (already) {
    d.log(
      DRAFT_ONLY.has(platform)
        ? `note  ${item.path} already has ${platform}: "${already}"; the publisher's draft is replaced, anything else refuses a second id`
        : `note  ${item.path} already has ${platform}: "${already}"; a claim refuses a second id`,
    );
  }

  if (dry) {
    d.log(`dry   ${platform} ${item.fm.slug} → ${id}`);
    d.log(`      ledger: ${JSON.stringify(row)}`);
    d.log(`      tag:    ${from}`);
    d.log(`      file:   ${item.path} would ${wouldMove(item, platform) ? 'move to published/' : 'stay where it is'}`);
    d.log('      nothing written');
    return 0;
  }

  let result: ClaimResult;
  try {
    result = await d.claim(item, platform, id, at);
  } catch (e) {
    d.error(`FAIL  ${platform} ${item.fm.slug}: ${(e as Error).message}`);
    return 1;
  }
  d.log(`claim ${platform} ${item.fm.slug} → ${id}${result.replaced ? ` (the draft ${result.replaced} is replaced; its row stays in the ledger)` : ''}`);
  d.log(`      ledger: ${JSON.stringify({ ...row, from: result.from })}`);
  d.log(`      tag:    ${result.from}`);
  d.log(`      file:   ${result.path}${result.moved ? ' (moved to published/)' : ' (stays until every platform is done)'}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}

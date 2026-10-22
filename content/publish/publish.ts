/**
 * Publish approved queue items. Nothing is posted unless every guard in
 * guards.ts passes for that item and that platform (the loop is run.ts).
 *
 *   npm run publish              # post what is due
 *   npm run publish -- --dry-run # print the plan, post nothing
 *   npm run publish -- --now     # ignore publish_at (still needs approved)
 *   npm run publish -- --only youtube  # one platform; the rest wait for the next run
 *
 * Before each post the attempt is recorded as a tag on the remote
 * (lib/databranch.ts), so a post whose ledger line is lost is never repeated:
 * the next run finds the tag with no ledger row and posts nothing (ADR 0089).
 * That needs a remote called origin, which is what the workflow and a clone
 * both have. A real run without one posts nothing.
 *
 * After a platform succeeds the post id is written into the queue file's
 * `published:` map and appended to publish/ledger.jsonl. Once every
 * scriptable platform on the item is done, the file moves to published/.
 * TikTok is sent as a draft to the founder's inbox and logged "drafted",
 * not "posted": the founder finishes it in the app (ADR 0086). Reddit
 * entries are printed for hand posting and never block the move.
 */
import { adapters } from './adapters.ts';
import type { Platform } from '../lib/queue.ts';
import { gitJournal, runPublish } from './run.ts';

const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? (argv[argv.indexOf('--only') + 1] as Platform | undefined) : undefined;
if (argv.includes('--only') && !ONLY) throw new Error('--only needs a platform, e.g. --only youtube');

const journal = gitJournal({ cwd: process.cwd() });

runPublish({ dry: argv.includes('--dry-run'), now: argv.includes('--now'), only: ONLY }, { adapters, journal })
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

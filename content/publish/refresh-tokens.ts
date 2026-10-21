/**
 * Renew the Threads and Instagram long-lived tokens before they expire.
 *
 *   npm run refresh:tokens              # renew both, write them to .env
 *   npm run refresh:tokens -- --github  # and update the repo's secrets (gh CLI)
 *
 * Meta's long-lived tokens last 60 days and can be renewed once they are a
 * day old, for another 60. The publisher cannot save a renewed token back to
 * GitHub, so this runs here, about monthly; the publisher warns when one is
 * within 10 days of expiring (THREADS_TOKEN_EXPIRES, IG_TOKEN_EXPIRES), and
 * `npm run tokens` renews on its own once a token is a day old. The renewal
 * itself lives in meta-tokens.ts, shared with that command.
 * A token from Facebook Login (not IGAA…) cannot be renewed this way.
 */
import { canRenewInstagram, renew } from './meta-tokens.ts';

const github = process.argv.includes('--github');

const results = [
  await renew('threads', { github }),
  canRenewInstagram(process.env.IG_ACCESS_TOKEN)
    ? await renew('instagram', { github })
    : (console.log('instagram: a Facebook Login token; renew it in the Meta dashboard'), { ok: true }),
];
if (results.some((r) => !r.ok)) process.exit(1);

# Analytics handover

Where the content analytics work stands on 22 October 2026 (updated the same day, once phases 3 and 4 had merged and the bots moved to a data branch), what is left of
phase 1, and what the next phases are. The why is `analytics-plan.md`; the
how of the running loop is `../CLAUDE.md` and `../README.md`. This file is
the state, so whoever picks it up next, person or Routine, starts from the
right place and not from the plan's first page.

## Where things stand

- **Phase 1, the pull, is merged** (PR #253, 22 October). The nightly
  `content-analytics` run is live from the next 03:15 Melbourne; the first
  real rows (`never-lead-anywhere` on Bluesky and Instagram at 0.65 days,
  the two account rows for 20 and 21 October) came in with the PR.
- **Phase 2, measure, score, brief, is merged** (PR #254, 22 October,
  after two independent review rounds). What it adds is under "Phase 2"
  below; the choices it made are in the plan, under "Phase 2, as built".
- **Phase 3, the Wenna export, is merged** (ADR 0087 as PR #256, the build as
  PR #257, SUS-244, 22 October): `analytics/platforms/wenna.ts` writes
  `funnel.jsonl` (circles made and plans shared by tag, counts only) and the
  scorecard has the two columns. It needs `WENNA_FUNNEL_URL` and
  `CONTENT_FUNNEL_SECRET` set (the first is a repository variable, the second
  a secret); unset, the pull says "not configured" and goes on.
- **Phase 4, the retro, is merged** (PR #255, 22 October): `npm run retro` and
  the `/retro` skill. Its fortnightly Routine is set up by hand in Claude Code
  (README, setup step 6); the first run is Tuesday 3 November, the morning
  after the first rows end.
- **The bots no longer push to `main`** (SUS-246, ADR 0089). `main` is
  protected, so the first nightly and series runs were rejected and their
  rows lost (run 39722895050, 22 October). The three workflows now commit to
  a `content-data` branch and keep one pull request open from it; the
  founder merges it (README, "Where the bots' work goes"). Until the first
  merge, `main` has none of the rows the pull writes, so everything below
  that says a run "commits rows" means to that branch.
- **The main checkout is clean.** The probes (`analytics/probe.ts`,
  `probe-extras.ts`), the 21 October draft of the plan and the `probe`
  script line are gone. `content/ads/` and its lines in `CLAUDE.md` and
  `package.json` are unrelated work in progress and were left alone.
- Nothing in phase 5 exists yet. ADR 0087 is written.

## What is left of phase 1

None of these is code. The phase-1 "done when" (four rows on four
platforms, a reply in `inbox/`, a transcribed screen) waits on them.

1. **Repository variables and secrets** the workflows read, or the run
   skips what is unset and says so. Variables: `BSKY_HANDLE`
   (`wennaapp.bsky.social`), `IG_USER_ID`, `THREADS_USER_ID`,
   `YOUTUBE_CHANNEL_ID`, `IG_TOKEN_EXPIRES` and `THREADS_TOKEN_EXPIRES`
   (`npm run tokens -- --github` writes the two dates), optionally
   `IG_API_VERSION`. Secrets: `IG_ACCESS_TOKEN` and `THREADS_ACCESS_TOKEN`
   (the publisher's workflow still reads the ids as secrets too, so both
   for now), `YOUTUBE_API_KEY`, and the three `YOUTUBE_*` OAuth values the
   publisher already has.
2. **YouTube re-consent with read scopes.** `npm run auth:youtube` in
   `content/` asks for `youtube.upload`, `youtube.readonly` and
   `yt-analytics.readonly`; replace `YOUTUBE_REFRESH_TOKEN` in `.env` and
   the secrets. Until then the API key reads the public numbers and the
   comment text; retention, traffic sources and the subscribed split come
   only with the re-consent. Keep the key after it: comments are read with
   the key alone, because OAuth reads them only under `youtube.force-ssl`,
   which can also edit and delete them and is never requested.
3. **The Threads sign-in** (`threads_basic`, `threads_manage_insights`,
   `threads_read_replies`), the long-lived token into `.env` and the
   secrets. The publisher needs the same token, so this unblocks posting to
   Threads as well as reading it.
4. **Transcribe the first two screens.** The Instagram Insights screenshots
   of 21 October, 8:46 pm Melbourne, for `never-lead-anywhere` go into
   `inbox/screens/never-lead-anywhere-instagram/`, then `/transcribe`. The
   legible values, as a cross-check: skip rate 45.5 %, like rate 9.1 %,
   share, save, repost and comment rates 0.0 %, sources Reels tab 57.1 %,
   Profile 28.6 %, Feed 14.3 %. The scorecard now shows the curve against
   the slide on screen (`never-lead-anywhere` has its `timing:`), which is
   the reason to transcribe it.
5. **Watch the first night.** The Actions page after 03:15 Melbourne: the
   run should commit rows, `features.jsonl`, the scorecard and
   `context/learned.md` to the `content-data` branch, open or update the data
   pull request (once "Allow GitHub Actions to create and approve pull
   requests" is on; otherwise it warns with a link), and stay green. Red after
   committing means an expiring Meta token, a platform that failed on every
   post, or a scorecard or brief that would not build; the log line says
   which. Red before committing means the data branch could not be read or
   written.
6. **GitGuardian** flagged a "bearer token" in
   `analytics/platforms/http.test.ts`: the fixture `ya29.abc-def_ghi/jk=` in
   the redaction test. Dismiss it as a false positive.
7. **Open point 3b is decided**: the pre-loop Bluesky post of 16 October
   stays out of the scorecard (22 October). Nobody runs `npm run posted`
   for it.

## Phase 2: measure, score, brief

What `claude/analytics-phase-2` adds:

- `lib/measure.ts`: the pure features of a queue file (family, shape,
  archetype, the hook's words and whether it holds a number, a quote or a
  time, slide and component counts, chats before the beat, messages and
  their median length, `when` stamps, skip, slow pace, caption asides, the
  cast, the screens, the quote's source, per platform the caption's length,
  sentences, question, link and hashtags, the YouTube title's length, the
  planned and the actual post hour and weekday in Melbourne) and `timingOf`,
  the before/after/per-slide seconds lifted out of `lib/check.ts`, which
  now calls it. `npm run video` writes `timing:` into the queue file's
  frontmatter when it builds; `npm run measure -- --timing <file>` does the
  same for a piece published before that, which is how
  `never-lead-anywhere` got its 28.17 s.
- `analytics/features.ts`: the nightly pull appends a `features.jsonl` row
  for a published piece whose measure is new or changed. No browser.
- `analytics/scorecard.ts`, `aggregates.ts`, `scorecard-md.ts` →
  `npm run scorecard` → `scorecard.json` and `scorecard.md`: per piece per
  platform at days 1, 3, 7 and 14 plus the latest, lift against the
  platform's day-7 median, watch and skip, the like rate listed and never
  ranked, replies and the ones quoting the hook, the first 48 hours from
  `series.jsonl` with the hour the curve bent, transcribed screens with the
  slide on screen at each tenth, the account as context lines, groups by
  family, shape, archetype, hour and weekday, ten feature splits, the
  control arm while its `experiments.md` row is live, and "too early" for
  everything under n=3.
- `analytics/brief.ts` → `npm run brief` → `context/learned.md`, dated,
  under sixty lines, every finding with its n. `/hooks` and `/skit` read
  it after `voice.md`, `facts.md` and `hooks.md`; `/review` fails a queue
  file that takes a claim from it. `experiments.md`'s "Link taps" is now
  "Circles made".
- `content-analytics.yml` runs the scorecard and the brief after the pull
  and stages `context/learned.md`; either failing turns the job red after
  the commit, never instead of it.
- Tests: a fixture of six pieces (`analytics/scorecard.fixture.ts`) is the
  phase's "done when"; 262 tests in all, `npm run typecheck` clean.

Merged as PR #254. Next: the first night with it (item 5).

## What is left, by phase

**Phase 3: the Wenna export** is done (see "Where things stand"). What
remains is the setup: the two values above, and the first night's
`funnel.jsonl` rows.

**Phase 4: retro** is done. Left: the fortnightly Routine (README, setup
step 6). Done when a fortnight's rows are filled by a PR nobody typed numbers
into.

**Phase 5: by evidence.** TikTok through its Business API, LinkedIn post
analytics if LinkedIn ever matters, Reddit read-only. One module and one
secret each.

## What the next person must know

- **`npm run <script> -- …`.** npm swallows a bare `--flag` typed before the
  `--`; `posted`, `hand` and `tokens` read the swallowed flags back from
  npm's environment and print a note, but the documented form has the `--`.
- **Account rows are for yesterday, UTC.** The nightly job runs at 16:15
  UTC, so today's Instagram day would be partial; Bluesky and the YouTube
  channel totals are read as they stand and stamp their own day.
- **Skip is not failure.** A module throws `Unreadable` or `NotConfigured`
  and the pull prints a `skip` outside the tally. Only a platform failing on
  every post it had, a Meta token inside seven days of expiry, or a
  scorecard or brief that would not build makes the job red, and only after
  the commit.
- **`raw` is committed whole, token scrubbed.** Anything naming a person is
  dropped inside the module.
- **The pull reads `queue/` as well as `published/`.** A piece stays in
  `queue/` until every scriptable platform has an id.
- **TikTok has two ledger rows per piece once posted**: `drafted` and
  `posted`; the posted one is the time it went out, and the one features
  and the scorecard age from. A claim made days after posting needs
  `--at <iso>` (`npm run posted -- tiktok <slug> <id> --at …`), or the
  claim's own time is taken as the post time and every age reads low.
- **Every number has one definition**, in `analytics/metrics.ts`; every
  threshold the scorecard and brief use (`MIN_N`, `LEAD`, `LAG`) is a named
  constant in `aggregates.ts` and `brief.ts`.
- **A Chromium for `--timing` and `npm run check`.** Playwright's own, from
  `npx playwright install chromium`, or any Chrome via `CHROMIUM_PATH`.
- **Tests inject their dependencies** and fixtures stand in for every
  platform answer; nothing in `npm test` touches the network. New code
  should follow that shape, and `npm run typecheck` runs on it in
  `content-check`.
- **Nothing here posts.** Every call in `analytics/` is a read; the
  publisher is the only thing that writes to a platform.

## Where to read more

- `docs/analytics-plan.md`: principles, data model, what each platform can
  give, the phases, "Phase 2, as built", the open points.
- `../CLAUDE.md` steps 6 and 7 and the Files table; `../README.md`,
  "Nightly and weekly".
- `analytics/platforms/module.ts` for the contract a new platform keeps;
  `analytics/metrics.ts` for the one place a metric or a rate is defined;
  `analytics/aggregates.ts` for what the scorecard compares.

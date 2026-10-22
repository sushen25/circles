# content

The content loop for Wenna, inside the Circles monorepo (ADR 0081). Claude
drafts, you merge, a script publishes. See `CLAUDE.md` for the loop and the
rules; this file is the ten-minute setup. Everything here runs with `npm`
from this folder, outside `pnpm check`.

## Setup

```bash
cd content
npm i
npx playwright install chromium      # for npm run render
cp .env.example .env                 # fill in what you have; Bluesky first
npm run typecheck                    # tsc over analytics/, nothing emitted
npm test                             # adapter and pull shapes, nothing sent
npm run render queue/2026-10-14-unpaid-project-manager.md
open out/unpaid-project-manager/contact.png
brew install ffmpeg                  # once; for npm run video
npm run video queue/2026-10-14-unpaid-project-manager.md
open out/unpaid-project-manager/unpaid-project-manager.mp4
npm run dry-run                      # dry-run publisher: prints the plan
```

## Going live, in order

1. **Bluesky** needs only a handle and an app password. Add them to
   `content/.env`, set `status: approved` on a queue file, run
   `npm run publish -- --now`.
2. **GitHub**: add the same values as secrets of the Circles repository, and
   `MEDIA_BASE_URL` as a repository variable. From then on merging a PR is
   approval and `.github/workflows/content-publish.yml` posts within the
   item's window and commits the ledger to the `content-data` branch, never
   to `main` ("Where the bots' work goes", below). The
   runner installs Chromium and runs `npm run render -- --approved` first,
   because `out/` is git-ignored and the publisher refuses a slideshow with
   no slides on disk; Bluesky and LinkedIn upload those PNGs directly.
   The two analytics workflows (`content-analytics.yml` nightly,
   `content-series.yml` every two hours) read the publisher's tokens plus
   `YOUTUBE_API_KEY`, and six repository variables: `BSKY_HANDLE`,
   `IG_USER_ID` and `THREADS_USER_ID` (account ids, public on every post,
   so variables rather than secrets), `YOUTUBE_CHANNEL_ID`, and
   `IG_TOKEN_EXPIRES` and `THREADS_TOKEN_EXPIRES` (the two dates are
   written by `npm run tokens -- --github`). A platform whose values are
   not set is skipped and says so; the only token that fails a run is one
   within seven days of expiring.
3. **Threads and Instagram** need a Meta app and a bucket (R2 or S3) that
   serves `out/` by URL. Renders are not committed here (`content/out/` is
   git-ignored), so the bucket is the host: `https://media.wenna.app`
   (`docs/runbooks/content-media.md`). The runner renders its own stills and
   MP4 (for Bluesky, LinkedIn, YouTube and TikTok, which take uploads) but
   has no upload step, so run `npm run upload queue/<file>.md` locally for a
   piece _before_ approving it; Threads and Instagram fetch yours from
   `MEDIA_BASE_URL/<slug>/`. Until `MEDIA_BASE_URL` is set the publisher
   skips those two platforms and says so.
4. **Daily Routine** (Claude Code → Routines): clone the Circles repo, work
   in `content/`, run `/daily`. It opens one PR a day on a `claude/` branch.
   You read it on your phone, edit if needed, merge.
5. **YouTube and TikTok** need a one-time sign-in each (`npm run auth:youtube`,
   `npm run auth:tiktok`; setup in `.env.example`). YouTube uploads are
   private until Google audits the API project. TikTok only ever gets a
   draft in your inbox: you add a sound and post it. Reddit is never
   scripted; the PR body and the publisher's `hand` lines carry its text.
   Who posts where is in `CLAUDE.md`.
6. **Fortnightly retro Routine** (Claude Code → Routines, beside the daily
   one): clone the Circles repo, work in `content/`, run `/retro`, every
   fourteen days on the morning after a row of `experiments.md` ends (the
   first is Tuesday 3 November 2026). It opens one PR a fortnight.

## Links

Every link the publisher posts carries a tag naming the post:
`wenna.app/?from=bs-only-moves` (Bluesky, the "only-moves" piece). Drafts
write `wenna.app` plain; the tag is added on publish and printed in the
`hand` lines for Reddit (and the `draft` line's caption for a TikTok video),
so paste those, not the draft. On the
Wenna side the tag lands on the circle's founder-only cohort row and the
funnel reads by it (circles SUS-240; until that ships the parameter is
ignored harmlessly).

Links that are not posts get a hand tag in the same shape: `?from=tt-bio`
on the TikTok profile, `ig-bio`, `rd-profile`, `cmp-doodle` on a comparison
page. Keep the list in `context/facts.md` so nobody invents a second scheme.

## Video

`npm run video` turns the same skit JSON into an animated 9:16 MP4 with
sound: kinetic hook, messages springing in behind typing bubbles, full-screen
time skips, a beat line, the grid ticking in, end card. Sound cues are
synthesised by FFmpeg, so there is nothing to license. Wherever a piece
has its MP4, the publisher posts the video, not the stills: the Reel, the
Short, the Threads and Bluesky posts, and the TikTok draft when the JPEG
stills are not at `MEDIA_BASE_URL` (the stills are the slideshow version of
the same piece; one or the other per platform, not both). LinkedIn stays
text-first with one still. Threads and Instagram fetch the MP4 from
`MEDIA_BASE_URL`; Bluesky uploads it. Drop a royalty-free track at
`render/audio/bed.mp3` and it is mixed in quietly with a fade. Timings live
at the top of `render/video.ts`.

## Where the bots' work goes

`main` is protected, so the three workflows (`content-publish`,
`content-analytics`, `content-series`) never push to it (ADR 0089). They push
to one branch, `content-data`, and keep one pull request open from it to
`main`, titled "content: data from the bots". Each run starts from that
branch (`main` plus the bots' unmerged work), so the publisher sees every
ledger line even before you merge, and a run that cannot read or write the
branch posts nothing and goes red.

**What you do**

- **Once**, in the repository's Settings, Actions, General, Workflow
  permissions: tick "Allow GitHub Actions to create and approve pull
  requests". Without it the workflows still work and the data still reaches
  `content-data`; they print a warning with a link and you open the pull
  request yourself. Leave "Read repository contents" as the default.
- **Weekly is enough** (nothing waits on it): open the data pull request,
  wait for `check` (the workflows start it on the branch; if it is missing,
  Actions, check, Run workflow, branch `content-data`), and merge it with
  **Create a merge commit**, then **Delete branch**. The next run starts
  again from `main`. Until you merge, `main` has no new analytics rows, and
  the `/daily` and `/retro` Routines, which read a clone of `main`, see
  last week's `learned.md`, scorecard and inbox.
- **Do not close the pull request and delete the branch unmerged**: the rows
  are lost. (Posts are not repeated either way.)
- Merging the data pull request never posts anything.

**When the publisher goes red with `BLOCKED …`**: before it calls a
platform it pushes a tag, `content-attempt/<platform>/<slug>`. If a tag has
no ledger row, a post may have gone out and its record was lost (a run was
killed, a push was rejected, the branch was deleted), and the publisher
posts nothing, for any piece, until you look at the platform:

```
npm run posted -- <platform> <slug> <url-or-id>   # it is live: records it
npm run attempt -- clear <platform> <slug>        # it is not: lets the publisher try again
```

Run them in a clone that has the branch merged into it (`git fetch && git
merge origin/content-data`), commit the ledger line through a pull request,
and the next run sees it. `npm run attempt -- attempts` lists the attempts.
A platform error (a 5xx, a timeout) leaves its tag in place on purpose: the
platform may have taken the post before it answered.

## Nightly and weekly

The why is in `docs/analytics-plan.md`; this is what runs on its own and
what is yours.

- **Nightly**, `content-analytics.yml` runs `npm run analytics` at 03:15
  Melbourne and commits what it wrote to `content-data`, all under `content/`:
  `analytics/posts.jsonl` (one row per post per platform, the platform's
  answer kept whole beside the common names), `analytics/account.jsonl`
  (the account by day: followers, the follower and non-follower split,
  views by surface) and any new replies into `inbox/<date>-replies.md` with
  the handles stripped, which the next `/daily` mines through `/mine`. A
  Short you set Public in Studio is claimed by the same run when its
  description carries the tag: the id lands in the queue file's
  `published:` map and a `by: hand` row in the ledger, so it is measured
  like a scripted post. The job goes red, after committing, when a Meta
  token is within seven days of expiry or a configured platform failed on
  every post; `npm run tokens` is the fix for the first.
- **Nightly, after the pull**, the same job runs `npm run scorecard` and
  `npm run brief`: `analytics/scorecard.md` is the dashboard (each piece's
  rate at days 1, 3, 7 and 14, its lift against the platform's median at
  day 7, and family, shape, hour and feature comparisons, each with its n
  and nothing ranked under three pieces), and `context/learned.md` is the
  short brief `/hooks` and `/skit` read. Neither is edited by hand. A piece
  published before its video build recorded `timing:` gets it with
  `npm run measure -- --timing queue/<file>.md`.
- **Every two hours**, `content-series.yml` runs `npm run analytics --
  --series` for any post under 48 hours old and commits
  `analytics/series.jsonl` to `content-data`, the views-over-time curve rebuilt from
  snapshots. With no young post it exits at once and commits nothing.
- **When you post by hand**, a TikTok draft you finished in the app, a
  Short the tag did not catch, a Reddit post:
  `npm run posted -- <platform> <slug> <url-or-id>` writes the id into the
  queue file and the ledger so the nightly pull reads it from then on; add
  `--at <iso>` when the platform cannot say when it went out.
- **Weekly, a minute per piece.** TikTok's numbers are read off the app:
  `npm run hand -- tiktok <slug> views=1240 saves=18 shares=9`, which
  replaces typing them into `experiments.md`. For the pieces that will
  decide a fortnight, drop the Insights screenshots (Instagram or TikTok)
  into `inbox/screens/<slug>-<platform>/` and run `/transcribe`: one
  `hand.jsonl` row per screen, the retention curve sampled at tenths, the
  images moved to `inbox/done/` and never committed.
- **Monthly**, `npm run tokens -- --github` reports what every token can do
  and when it expires, renews the Threads and Instagram ones once they are a
  day old, and writes the new token to the repository's secrets and its
  expiry date to the variables with the gh CLI; the Action cannot write its
  own secrets. It folds in `npm run refresh:tokens -- --github`, which
  still works and does the renewal alone.
- **Fortnightly**, the morning after a fortnight ends, `/retro` (its own
  Routine, step 6 of the setup) runs `npm run retro -- --write`, which fills
  that fortnight's number cells in `experiments.md` from the scorecard, then
  writes each row's Result and Next, proposes the next fortnight's rows and
  opens one PR. On day 30 of a family the PR carries the standing rule,
  kill the two worst and double the best, as a proposal. Merging is the
  decision; nobody types a number into the table.

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
   item's window and commits the ledger back, touching only `content/`. The
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

## Nightly and weekly

The why is in `docs/analytics-plan.md`; this is what runs on its own and
what is yours.

- **Nightly**, `content-analytics.yml` runs `npm run analytics` at 03:15
  Melbourne and commits what it wrote, all under `content/`:
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
- **Every two hours**, `content-series.yml` runs `npm run analytics --
  --series` for any post under 48 hours old and commits
  `analytics/series.jsonl`, the views-over-time curve rebuilt from
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
- Run `/review` on `experiments.md` on day 30 of each family: kill the two
  worst, double the best.

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
   item's window and commits the ledger back, touching only `content/`.
3. **Threads and Instagram** need a Meta app and a bucket (R2 or S3) that
   serves `out/` by URL. Renders are not committed here (`content/out/` is
   git-ignored), so the bucket is the host: upload `out/<slug>/` for a piece
   before approving it. Until `MEDIA_BASE_URL` is set the publisher skips
   those two platforms and says so.
4. **Daily Routine** (Claude Code → Routines): clone the Circles repo, work
   in `content/`, run `/daily`. It opens one PR a day on a `claude/` branch.
   You read it on your phone, edit if needed, merge.
5. **TikTok and Reddit** are never scripted. The PR body and the publisher's
   `hand` lines carry the text; you post them.

## Links

Every link the publisher posts carries a tag naming the post:
`wenna.app/?from=bs-only-moves` (Bluesky, the "only-moves" piece). Drafts
write `wenna.app` plain; the tag is added on publish and printed in the
`hand` lines for TikTok and Reddit, so paste those, not the draft. On the
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
synthesised by FFmpeg, so there is nothing to license. Post it as a TikTok
or Reel by hand (the PNGs are the slideshow version of the same piece; use
one or the other per platform, not both). Drop a royalty-free track at
`render/audio/bed.mp3` and it is mixed in quietly with a fade. Timings live
at the top of `render/video.ts`.

## Weekly

- `npm run analytics` runs nightly on GitHub (`content-analytics.yml`);
  `analytics/posts.jsonl` grows.
- Enter TikTok views, saves and shares into `experiments.md` by hand.
- Run `/review` on `experiments.md` on day 30 of each family: kill the two
  worst, double the best.

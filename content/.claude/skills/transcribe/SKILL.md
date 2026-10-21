---
name: transcribe
description: Read the Insights screenshots the founder dropped into inbox/screens/<slug>-<platform>/ and append one hand.jsonl row per screen through npm run hand. Use when asked "/transcribe" or when there are files under inbox/screens/.
---

# /transcribe

Three things Instagram shows for a Reel exist in no API: the retention
curve, views over time, and where the views came from. TikTok's in-app
analytics are the same story. The founder takes the three or four
screenshots, drops them in a folder, and this skill reads the numbers off
them into `analytics/hand.jsonl`, one row per screen, through
`npm run hand`. You read; `npm run hand` writes. You never edit a `.jsonl`
by hand and never commit an image.

## Inputs

- A folder per piece and platform: `inbox/screens/<slug>-<platform>/`, where
  `<slug>` is the queue file's slug and `<platform>` is `instagram` or
  `tiktok`. Several folders at once is fine; take them in name order.
- PNG or JPEG, any number per folder. One screen per image, usually; a long
  screenshot that holds two screens is two rows.
- The screenshot's own date and time when the screen shows one; otherwise
  the file's modification time.

Read `docs/analytics-plan.md`, "Capture everything", once, so you know what
the rows are for: the scorecard reads the retention curve's tenths beside
the piece's slide timings, so "where people left" can be read against
"which slide was on screen".

## The screens it knows

Name the screen with one of these words. A screen that is none of them gets
the nearest word and a line in your output saying what it was.

**Instagram, Reel insights**

| Screen | `--screen` | What it yields |
|---|---|---|
| The overview: views, reach, watch time, skip rate, the follower share, likes, comments, shares, saves | `overview` | `views`, `reach`, `watch_total_s`, `watch_avg_s`, `skip_pct`, `likes`, `comments`, `shares`, `saves`, and `points.followers` as `{"followers": 62, "non_followers": 38}` |
| The retention curve (the line that falls across the video's length) | `retention` | `points.retention`: percentages at tenths of the video, keyed `"0.0"` to `"1.0"`, eleven when the whole line is readable |
| Views over time (the line across the first days) | `views_over_time` | `points.views_over_time`: the labelled values only, keyed by the axis label as written (`d1`, `d2` or `h6`, `h12`) |
| View sources by surface (Reels tab, Profile, Feed, Explore, Other, as the app names them) | `sources` | `points.sources`: percentages keyed by the surface's name, lowercased, spaces to underscores |

**TikTok, video analytics**

| Screen | `--screen` | What it yields |
|---|---|---|
| The overview: views, likes, comments, shares, saves, total play time, average watch time, watched full video, new followers | `overview` | `views`, `likes`, `comments`, `shares`, `saves`, `watch_total_s`, `watch_avg_s`, `full_watch_pct` (watched full video; not `watch_pct`), `followers_gained` |
| Retention | `retention` | `points.retention`: eleven percentages at tenths, as for Instagram |
| Traffic sources (For You, Profile, Following, Search, Sound, Other, as the app names them) | `traffic` | `points.traffic`: percentages keyed by the source's name, lowercased, spaces to underscores |
| Viewer types (new and returning; followers and non-followers) | `viewers` | `points.viewers`: percentages keyed as the app labels them, lowercased |

The metric names are the common ones from `analytics/metrics.ts`
(`views`, `reach`, `likes`, `comments`, `shares`, `saves`, `watch_avg_s`,
`watch_total_s`, `watch_pct`, `skip_pct`). A number the screen shows that
has no common name keeps the app's own label, lowercased, spaces to
underscores (`followers_gained`, `profile_visits`). `watch_pct` is never
read off a screen: `metrics.ts` defines it as the average watch time over
the piece's length and derives it from `watch_avg_s` when a screen gives
the average, so TikTok's "watched full video" percentage is a different
number and is recorded as `full_watch_pct`.

## Steps

For each folder, in name order, and for each image in it:

1. Look at the image and name the screen from the tables above. Say which
   platform and slug it is for from the folder name, and check that the
   slug exists in `queue/` or `published/`; if it does not, stop on that
   folder and say so.
2. Read every number that is legible. Write it the way `hand.jsonl` stores
   it:
   - counts as integers (`1240`), with the app's thousands separators
     removed; an abbreviated count (`1.2K`) is written as the app shows it
     would round, `1200`, and your output says it was abbreviated;
   - percentages as plain numbers, `22.6` for 22.6 %, never `0.226`;
   - times in seconds: `11.3s` is `11.3`, `3m 42s` is `222`, `1h 02m` is
     `3720`.
3. For a retention curve, sample the line at tenths of the video, 0.0 to
   1.0, eleven points, reading each value off the vertical axis. Record a
   point only where the line is visible and its value can be read; where it
   is not, leave that tenth out and say so. The points are a map keyed by
   the tenth, so a missing one leaves no hole and no guess:
   `{"0.0": 100, "0.1": 84, "0.2": 71, "0.3": 66, "0.5": 58, …, "1.0": 44}`.
4. Take the capture time from the screenshot when a screen shows it (a
   "last updated" line, or the date on the screen with the clock in the
   status bar); otherwise use the file's modification time, which the same
   Node this folder runs on prints the same way on a Mac and in Linux:
   `node -e 'console.log(require("fs").statSync(process.argv[1]).mtime.toISOString())' "inbox/screens/<slug>-<platform>/<file>"`.
   Say which of the two it was.
5. Write the row, once per screen:

   ```
   npm run hand -- <platform> <slug> <key=value ...> --by transcribed --screen <name> --captured-at <iso> --points '<json>'
   ```

   The `--` after `hand` is not optional: npm swallows a bare `--flag` that
   comes before it, and `hand.ts` would never see `--by` or `--points`.
   `<key=value ...>` is the flat metrics; `--points` is a JSON object whose
   values are the maps above, each a name to a number. Leave `--points` out when the
   screen has none (an overview with no follower share), and leave the
   metrics out when the screen is only a curve. For example:

   ```
   npm run hand -- instagram take-a-break views=1240 reach=911 watch_avg_s=11.3 skip_pct=22.6 shares=9 saves=18 --by transcribed --screen overview --captured-at 2026-10-28T09:12:00Z --points '{"followers":{"followers":38,"non_followers":62}}'
   npm run hand -- instagram take-a-break --by transcribed --screen retention --captured-at 2026-10-28T09:12:00Z --points '{"retention":{"0.0":100,"0.1":84,"0.2":71,"0.3":66,"0.5":58,"0.6":55,"0.7":52,"0.8":49,"0.9":47,"1.0":44}}'
   ```

6. When every image in the folder has its row, move the images out of the
   way so the next run does not read them again:

   ```
   mkdir -p inbox/done/<slug>-<platform>
   mv inbox/screens/<slug>-<platform>/* inbox/done/<slug>-<platform>/
   ```

   The images are the source and stay on this machine; the numbers are
   what is committed. Stage `analytics/hand.jsonl` and nothing from
   `inbox/`.

## Never

- Never invent a point that is not on the screen, and never type a number
  you cannot read. A blurred or cropped value is left out and named in the
  output as unreadable; a guess is worse than a gap.
- Never smooth, interpolate or round a curve to make it look right. The
  scorecard shows the row as `by: transcribed` for exactly this reason.
- Never commit the images. `inbox/screens/` is git-ignored; what you moved
  to `inbox/done/` is not staged either.
- Never read a screen that shows a person: a comment thread, a follower
  list, a viewer's name. That screen is skipped and named in the output.
- Never edit `analytics/hand.jsonl` directly, and never run anything but
  `npm run hand`. Nothing here posts, and nothing here reads a platform.

## Output

The rows written, one line each: `<platform> <slug> <screen> <captured-at>`
and the keys it holds. Then, in one line each, every value that was
unreadable, every screen you could not name, and every folder you stopped
on.

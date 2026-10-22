# Analytics plan

The loop today runs one way: Claude drafts, the founder merges, a script
publishes. This plan closes it. Every post's numbers come back nightly, the
pieces themselves are measured, the two are joined into a scorecard, a short
generated brief tells the drafting skills what has worked, and a fortnightly
retro proposes what to kill and what to double. The hard rules in
`../CLAUDE.md`, `../context/voice.md` and `../context/facts.md` do not change:
nothing here posts on its own, and nothing here adds a claim to facts.md.

## Status

Proposed 21 October 2026, with the decisions below taken the same day.
Phase 1 (the pull) merged on 22 October (PR #253), and phase 2 (measure,
scorecard, brief) the same day (PR #254); what it decided where this plan
left a choice is under "Phase 2, as built" in "Phases". Phase 4 (the retro)
is built on `claude/analytics-phase-4`, ahead of phase 3, which waits on open
point 1; its choices are under "Phase 4, as built". Phase 5 is not started.

Before phase 1, nothing was built. A read-only probe of what the tokens in
`.env` can see was run the same evening from a session scratchpad; it is not
in the repository and neither are its reports (`probe-report.json`,
`probe-extras.json`, every secret redacted). What it found, and what each
finding means:

- **Bluesky** reads with no token at all: 2 posts, both with a video embed.
  One (16 October) was posted by hand and is in no ledger; the other
  (21 October, `never-lead-anywhere`) was posted by the script and is in the
  ledger with its tag. Likes, reposts, replies, quotes; no views. The account
  is `wennaapp.bsky.social`; `.env.example` said `wenna`.
- **Instagram** works as a Business account through Instagram Login
  (`graph.instagram.com`): 1 Reel, the same piece, posted by the script.
  Every Reel metric the plan wants is accepted: `views`, `reach`, `saved`,
  `shares`, `likes`, `comments`, `total_interactions`,
  `ig_reels_avg_watch_time` and `ig_reels_video_view_total_time` (both in
  milliseconds), `reels_skip_rate` (a percentage). `reposts` per Reel is
  refused on v21, v22, v24 and v26 alike. Every account-level breakdown the
  plan wants works: reach and views by follower / non-follower and by
  surface, the interaction counts by surface, link taps by button, the reach
  time series; the under-100-followers metrics come back empty rather than
  failing. Comments are readable with the current token. The same Reel read
  6 views and a 40 % skip rate at three hours and 33 views, reach 14, 11.3 s
  average watch and 22.6 % skip rate at five and a half: early numbers move
  fast, which is the case for the two-hourly series. The token has 59 days
  left; `IG_TOKEN_EXPIRES` is an ISO date, so the pull reads a date, not a
  timestamp.
- **Threads** has no usable token (`Cannot parse access token`): the value in
  `.env` is a placeholder. The Threads rows below wait for the OAuth
  sign-in that gives a long-lived token with `threads_basic` and
  `threads_manage_insights` (and `threads_read_replies` for replies).
- **YouTube**'s refresh token carries only `youtube.upload`. It can post a
  Short and read nothing: `channels.list` is refused. Reading needs a
  re-consent with `youtube.readonly` and `yt-analytics.readonly`, which can
  be the same token as the upload one. Public numbers (views, likes,
  comments, and comment text) also come with an API key alone, which is
  the fallback that needs no consent at all. The upload scope is in use: the
  publisher's YouTube adapter posted the first Short on 21 October
  (ADR 0086).
- **TikTok** and **LinkedIn** have no credentials, as expected.

What existed before phase 1, and what it lacked:

- `../analytics/pull.ts` appended one row per published post per night to
  `analytics/posts.jsonl`, for Bluesky (public API), Threads and Instagram.
  No YouTube, no TikTok, no LinkedIn, no Reddit. It read only `published/`,
  so a piece still in `queue/` because one platform is unconfigured (the
  case for `never-lead-anywhere`, whose Threads, LinkedIn and TikTok are
  not set up) was invisible; and a hand-posted TikTok or Short has no id
  anywhere, so it was invisible too.
- `content-analytics.yml` runs it nightly at 03:15 Melbourne and commits the
  file. It has the Threads and Instagram secrets only.
- `../experiments.md` is the only analysis: hand-filled, fortnightly, with
  "Plans shared" blank until the by-tag funnel can be read from this side.
- On the Wenna side, every published link carries `?from=<platform>-<slug>`
  (`../lib/links.ts`) and the funnel reads by it on `/founder/analytics`
  (ADR 0084, SUS-240), behind the founder allowlist. Nothing outside that
  screen can read it.
- The ledger holds three rows, all for `never-lead-anywhere` on 21 October
  (Instagram, Bluesky, YouTube), each with its tag; `posts.jsonl` is empty.
  The first real numbers arrive with the first nightly run of phase 1.

## Decisions taken (21 October 2026)

- **The Wenna funnel is pulled nightly through a keyed export, counts only.**
  A new internal Edge Function behind its own secret, by the same
  `internalHandler` the cron endpoints use. It is a new door to the cohort
  table, so it is an ADR (below), written before the function.
- **Analysis reaches drafting through a generated brief and a fortnightly
  retro, not through daily picks.** `context/learned.md` is generated and read
  by `/hooks` and `/skit` the way `voice.md` is; `/retro` proposes the next
  rows of `experiments.md` as a PR. Within a fortnight `/daily` keeps rotating
  evenly, so the arms stay comparable. A score-driven daily pick was rejected:
  it confounds the experiment and over-fits on one or two pieces.
- **Reply text is pulled nightly into `inbox/`, handles stripped**, so
  `/daily`'s step 2 mines it through `/mine` without anyone pasting. The repo
  is public; what lands there is public comment text with no usernames.
- **The pieces are measured too.** Seconds, slide and chat counts, the hook's
  shape, caption lengths, the publish hour and the rest are read from the
  queue file itself and joined to the numbers, so the brief can say what about
  a piece worked and not only which family it was in.
- **Likes are not a metric. Nothing posts on its own. Facts come from
  facts.md only.** Unchanged, and the scorecard enforces the first.

## Principles

- **Counts and text, never people.** Platform usernames, handles and profile
  links are stripped before anything is written; follower lists and DMs are
  never pulled. Audience demographics are pulled only as the platforms give
  them, bucketed counts (age band, city, country) above a 100-follower floor,
  at account level; nothing about an individual, ever. On the Wenna side the
  export returns what the founder screen shows: counts by tag, no circle,
  plan or person.
- **Capture everything the API gives, whole.** Every metric a platform
  returns for a post or the account is stored as returned (`raw`) beside the
  mapped names, breakdowns included, whether or not the scorecard uses it
  yet. What a platform shows only in its app is captured by the two routes
  under "Capture everything" below. The scorecard chooses what to rank;
  the pull never chooses what to keep.
- **The script computes, a person decides.** Every number in the repo is
  generated or hand-entered through a command. Hypotheses, results and "next"
  are written by a person, through a PR Claude opens and the founder merges.
- **One definition per metric**, in `analytics/metrics.ts`, read by the
  scorecard, the brief and the retro. Like `render/components/`: one
  implementation, every output from it.
- **Age-matched or nothing.** A post is compared with another at the same
  age, on the same platform: day 1, day 3, day 7, day 14. "Current against
  current" is never computed.
- **A minimum n before a claim.** The brief says nothing about a family,
  shape, archetype or feature with fewer than three pieces at the comparison
  age; it says "too early". Medians, not means.
- **Platforms are not pooled.** Saves per thousand views on Instagram and
  replies per post on Bluesky are different numbers; each family's lift is
  measured against the running median of all pieces on that platform at that
  age, and the per-platform lifts are what get compared.
- **Off until configured, loud when expiring.** A platform with no token is
  skipped and says so; a token inside seven days of expiry fails the nightly
  run so somebody notices, while everything that succeeded is still committed.

## The loop, closed

```
/mine ─► /hooks ─► /skit ─► /review ─► PR ─► merge ─► publish
  ▲                  ▲                                     │
  │                  │ reads context/learned.md            │ ledger, published ids
  │                  │                                     ▼
inbox/<date>-replies.md ◄── replies ◄── nightly pull ──► posts.jsonl, funnel.jsonl
                                              │
                      measure the pieces ─────┤
                                              ▼
                                        scorecard.{json,md} ─► brief ─► context/learned.md
                                              │
                               fortnightly    ▼
                                           /retro ─► experiments.md rows ─► PR ─► merge
```

Daily: one piece (as now). Nightly: pull, measure, score, brief. Fortnightly:
retro. The founder's hands touch two things: merging PRs, and the weekly
minute of hand numbers (TikTok, until its API is set up).

## What each platform can give

Confirmed by the probe on 21 October where it says so; the rest is what the
documentation says. "Post id" is how the pull knows which remote post is which
piece; the publisher writes ids for the platforms it posts to, and the
hand-posted ones need the two commands under "Hand posts" below.

| Platform | Posted by | Post id | Per-post metrics | Replies | Auth and expiry |
|---|---|---|---|---|---|
| Bluesky | script | ledger | likes, reposts, replies, quotes. No views. (confirmed) | public thread, no auth | none for reading (confirmed) |
| Instagram | script (Reel when the MP4 exists) | ledger | Reels (confirmed): views, reach, saved, shares, likes, comments, total_interactions, avg watch time and total watch time in ms, skip rate in %. `reposts` per Reel is refused on every API version up to v26; it exists only at account level. Feed (documented): views, reach, saved, shares, likes, comments, follows, profile_visits. Account by day (confirmed): reach and views split by `follow_type` (follower / non-follower) and by `media_product_type` (Reel, Feed, Story, Ad); likes, comments, shares, saves, total_interactions by surface; replies, reposts, accounts_engaged, profile_links_taps by button; reach as a day-by-day time series. Under 100 followers, follows_and_unfollows, follower_count, online_followers and the demographics come back empty, not as errors. In-app only: the retention curve, views over time per post, follower split and view sources per post. | comments endpoint, readable with the current token (confirmed) | long-lived token, 60 days, 59 left; refresh when over a day old (confirmed working through Instagram Login) |
| Threads | script | ledger | views, likes, replies, reposts, quotes, shares. Account by day: views, likes, replies, reposts, quotes, clicks, followers_count; follower demographics above 100 followers. (documented; no token yet) | replies endpoint, `threads_read_replies` | long-lived token, 60 days; the current value is a placeholder |
| YouTube | script (Short, private until the founder sets it Public in Studio; ADR 0086) | ledger, or auto-claimed by tag, or `npm run posted` | Data API: views, likes, comments (with an API key, no consent). Analytics API, after re-consent with `youtube.readonly` + `yt-analytics.readonly`: everything Instagram shows only in its app, natively: the retention curve per video (`elapsedVideoTimeRatio` × `audienceWatchRatio`), subscribed vs not, traffic sources and their detail, playback location, device, country, sharing service, demographics, per-day series; plus views, engaged views, minutes watched, average view duration and percentage, shares, subscribers gained. The current token has `youtube.upload` only (confirmed). | commentThreads, public with an API key | OAuth refresh token, does not expire while used |
| TikTok | script drafts, founder posts | `npm run posted` | hand: views, saves, shares (weekly), plus the in-app screens by screenshot. Display API (developer app, one sign-in): view, like, comment, share counts only. Business API (a Business account and app approval): video views, likes, comments, shares, reach, full-video-watched rate, total and average time watched, impression sources, audience countries; account followers by day, profile views, audience activity by hour, demographics. | hand | the Business API is the one worth the approval |
| LinkedIn | script | ledger | none yet: member post analytics is a separate API product (`r_member_postAnalytics`). Deferred. | none | token in `.env.example`, not set |
| Reddit | by hand, drafts only | `npm run posted` | hand, if ever. Deferred. | hand | none |

Link taps per post are not available from any of these; Threads reports
clicks at account level only. The first readable number after the tap is on
the Wenna side: circles made by tag. `experiments.md`'s "Link taps" column
becomes "Circles made" (open point 4).

## Data model

Everything under `content/analytics/` unless said otherwise. One line per
record, append-only, committed nightly by the bot; the scorecard and the
brief are regenerated from them and committed too.

| File | What | Written by |
|---|---|---|
| `posts.jsonl` | one row per published post per platform per night: `date` and `at` (the pull's UTC day and time), `slug`, `family`, `platform`, `id`, `from`, `posted_at` (when the post went out), `age_days`, `metrics` in the common names from `metrics.ts` (`views`, `reach`, `likes`, `comments`, `replies`, `shares`, `saves`, `reposts`, `quotes`, `watch_avg_s`, `watch_total_s`, `watch_pct`, `skip_pct`, `engaged_views`), plus `raw` as the platform returned it, every metric and breakdown included | `npm run analytics` |
| `series.jsonl` | the same row shape plus `age_hours`, every two hours for a post's first 48 hours: the views-over-time curve, rebuilt from snapshots | `npm run analytics -- --series` |
| `account.jsonl` | one row per platform per day for the account itself. `date` is the UTC day the numbers describe: the day before the pull for a platform that reports by day, and the pull's own day for Bluesky and the YouTube channel totals, which are read as they stand; `at` is the pull time. Then followers, reach and views split by follower / non-follower and by surface, likes, comments, shares, saves by surface, profile link taps, accounts engaged, follows and unfollows, online-followers hours, and the demographic buckets once the platform returns them; `raw` beside the mapped names | `npm run analytics` |
| `funnel.jsonl` | one row per tag per night from the Wenna export: `circles`, `plans_shared`, `answered`, `confirmed`; and one row per night for the `content` source's stalled first plans by state | `npm run analytics` (phase 3) |
| `hand.jsonl` | hand-entered numbers: `date`, `at`, `slug`, `platform`, `metrics`, `by` (`hand` for a typed number, `transcribed` for one read off a screen), and for a transcribed screen `screen` (the screen's name), `captured_at` (when the screenshot was taken) and `points` (a retention curve sampled at tenths, view sources as percentages, the follower split) | `npm run hand`, `/transcribe` |
| `replies-seen.json` | a hash of `<platform>:<id>` for every reply already written to `inbox/`, so each is written once and a Bluesky reply's `at://` uri, which names the replier, never lands in the file | `npm run analytics` |
| `features.jsonl` | one row per piece: what the piece is, measured from the file (below) | `npm run measure`, run by the pull for any piece without a row |
| `scorecard.json`, `scorecard.md` | the joined, age-matched tables | `npm run scorecard` |
| `../context/learned.md` | the brief: what to do more of, what to stop, too early, best windows; under sixty lines, dated, never hand-edited | `npm run brief` |
| `../inbox/<date>-replies.md` | reply text with handles stripped, one section per piece and platform, for `/mine` | `npm run analytics` |
| `../publish/ledger.jsonl` | unchanged; gains hand posts' rows with `by: hand` | publisher, `npm run posted` |

The `published:` map in a queue file is unchanged in shape and gains entries
for hand posts, so a piece is "published on youtube" the same way it is
"published on bluesky". The pull reads the map from `queue/` as well as
`published/`: a piece moves to `published/` only once every scriptable
platform is done, and a platform that is not configured keeps it in `queue/`.

## Pull

`pull.ts` becomes a small orchestrator over one module per platform in
`analytics/platforms/`, the way `publish/adapters.ts` is one thin function per
platform: `bluesky.ts`, `instagram.ts`, `threads.ts`, `youtube.ts`, later
`tiktok.ts`, and `wenna.ts` for the funnel. Each exports `metrics(id)` and
`replies(id, since)` and returns the common row; the platform's raw answer is
kept beside it so a renamed metric never loses history.

- **Ages.** The row carries `age_days` from the ledger's `at` (the actual,
  jittered time the post went out), which is what the scorecard aligns on.
- **Hand posts and auto-claim.** The publisher prints the hand text with the
  tag already in it. A hand post whose caption or description carries its
  tag (`from=yt-<slug>` on a Short) is claimed by the pull without anyone
  typing: it scans the recent feed of every platform whose module has one
  (Bluesky, Instagram, Threads and YouTube), matches the tag, writes the id
  into the queue file's `published:` map and a `by: hand` row into the
  ledger with the platform's own publish time. TikTok captions rarely carry
  the link (it is not clickable there and the caption is 150 characters),
  so TikTok is claimed by hand: `npm run posted -- tiktok <slug> <url>
  [--at <iso>]`, which takes the video id out of the pasted URL. A TikTok
  draft's `publish_id`, which the publisher leaves in the `published:` map
  with a `drafted` ledger row, is replaced by the video id when the founder
  claims it, and a `posted` row is appended under the `drafted` one. The
  same command works for any platform when auto-claim has nothing to match,
  Reddit included, where the URL is the id.
- **Hand numbers.** `npm run hand -- tiktok <slug> views=1240 saves=18
  shares=9` appends to `hand.jsonl` with today's date; the scorecard treats
  a hand row as a snapshot like any other. This replaces typing into
  `experiments.md`. The `--` after the script name is what lets a flag reach
  the script: npm swallows a bare `--flag` otherwise.
- **Replies.** Each platform's `replies` returns `{ id, at, text }` and nothing
  else: the module drops the author before returning. The pull writes new ones
  (not in `replies-seen.json`) to `inbox/<date>-replies.md` under
  `## <slug> · <platform>` headings, one blockquote each, and `/mine` does the
  rest: it already skips anything naming a person, a workplace or a health
  detail. Replies by the account itself are dropped. A reply that quotes the
  hook back is a declared metric; the scorecard counts it by matching the
  hook's words, case-insensitively, against the reply.
- **Tokens.** `npm run tokens` reports every token's state and, for
  Instagram and Threads, performs the refresh when the token is over a day
  old and prints the `gh secret set` line to run; the Action cannot write its
  own secrets, and a token that can is a bigger secret than the one it would
  refresh. The pull reads `IG_TOKEN_EXPIRES` (an ISO date) and the Threads
  equivalent and exits non-zero inside seven days of expiry, after writing
  what it got; it exits non-zero the same way when a configured platform
  failed on every post it had. A platform that cannot read with the
  credentials it has (a private Short with an API key alone, an upload-only
  YouTube token) is a skip, not a failure.
- **Rate.** One piece a day on four platforms is a handful of calls a night.
  No retries beyond one; a platform that fails is printed and the others
  continue, as the publisher does.

## Capture everything

"Capture everything possible everywhere" sorts into three tiers per
platform, and the pull takes all three.

**Tier 1: per post, from the API.** Stored whole. Instagram Reels give
views, reach, saves, shares, likes, comments, total interactions, average
and total watch time, skip rate (and, if a newer API version accepts it,
reposts); YouTube gives views, likes, comments from the Data API and, after
the re-consent, the retention curve, subscribed-or-not, traffic sources,
playback location, device, country, sharing service and a per-day series
from the Analytics API; Threads gives views, likes, replies, reposts, quotes,
shares; Bluesky gives likes, reposts, replies, quotes; TikTok's Business API
gives views, likes, comments, shares, reach, full-video-watched rate, total
and average time watched, impression sources. Every rate Instagram shows
under "What affects your views" is a count divided by views, so
`metrics.ts` derives skip, share, like, save, comment and repost rates from
the stored counts; the like rate is stored and shown but never ranked.
`raw` keeps the brand account's own identity, since its handle, id and
channel title come back in every response, and strips other people's: a
quoted or mentioned author on Bluesky never reaches the file.

**Tier 2: per account per day, from the API.** `account.jsonl`. This is
where the follower / non-follower split lives on Instagram (reach and views
by `follow_type`, and by surface: Reel, Feed, Story, Ad), with likes,
comments, shares, saves and total interactions by surface, profile link
taps, accounts engaged, follows and unfollows, online-followers hours, and
the demographic buckets once the account is past 100 followers. Threads
adds clicks and followers by day; Bluesky adds followers; TikTok's Business
API adds followers by day, profile views and audience activity by hour.
Per post, Instagram does not split by follower status or by source; the
account-level split is the best the API offers, and the scorecard reads it
beside the post's own numbers.

**Tier 3: in-app only.** Three things Instagram shows for a Reel exist in
no API: the retention curve, views over time, and the per-post follower
split and view sources (Reels tab, Profile, Feed). TikTok's in-app
analytics are the same story until the Business API is set up. Two routes:

- **Polling** rebuilds views over time. `npm run analytics -- --series`
  pulls every post under 48 hours old and appends to `series.jsonl`; a
  workflow runs it every two hours. It exits at once when no post is that
  young.
- **Screenshots** carry the rest. The founder drops the Insights screens
  (the three or four screenshots it takes) into `inbox/screens/<slug>-<platform>/`.
  `/transcribe`, a small skill, reads them and appends one `hand.jsonl` row
  per screen: the retention curve sampled at tenths of the video, the view
  sources as percentages, the follower share of views, the rates as shown;
  it names the screen and the capture time, never invents a point it
  cannot see, and moves the images to `inbox/done/`. The images are never
  committed (`inbox/screens/` is git-ignored); the numbers are. A weekly
  minute per piece, for the two or three pieces worth it.

What this does not reach: anything the platform shows nobody (Instagram's
ranking signals), anything about an individual viewer, and link taps per
post, which no platform reports and the Wenna funnel answers instead.

## Content features

"Pull metrics from the uploaded content itself": the piece is data too, and
it is the data the drafting skills can act on. `lib/measure.ts` turns a queue
file into one row; `npm run measure <file>` prints it and the pull writes it
for every published piece that has none. Two kinds of feature:

- **Pure, from the JSON and the captions**, no browser needed: `family`,
  `shape`, `archetype`, `hook` and its length in words, whether the hook holds
  a number, a quote or a time; slide count and the count of each component
  type; chats before the beat; messages in total, per chat, median length;
  the number of `when` stamps and whether a `skip` is used; whether `pace:
  slow` is used and where; how many `caption` asides; the `me` character and
  the cast size; whether there is an availability screen, a locked screen, a
  compare, a grid; the quote's source kind (subreddit, DMs, comments); per
  platform, the caption's length, sentence count, whether it ends in a
  question, whether it carries the link, the hashtag count; the YouTube
  title's length; `publish_at` hour and weekday in Melbourne, and the
  platform's actual post hour from the ledger.
- **Timed, from the video build**: total seconds, before and after seconds,
  seconds per slide. `lib/check.ts` already measures these in Chromium; the
  measurement moves into `measure.ts` and `check.ts` calls it, so the rule
  and the feature come from one place. `npm run video` is the job that has
  Chromium at hand when a piece is published (`content-publish.yml` renders
  before it posts), so the video build writes `timing:` into the queue
  file's frontmatter and the nightly pull never needs a browser.

What the scorecard does with features is deliberately simple: splits, not
regressions. Each feature with two natural sides (total under 28 s or over;
two chats before the beat or three; hook with a number or without; caption
ending in a question or not; posted before 7 pm Melbourne or after) gets the
median day-7 rate on each side with its n, and the brief reports a split only
when both sides have at least three pieces and the gap is larger than the
spread within the sides. With one piece a day this takes a month to say
anything, which is the honest timescale.

## Scorecard

`npm run scorecard` reads the five `.jsonl` files, the ledger and the queue
and published frontmatter, and writes `scorecard.json` and `scorecard.md`.

- **Per piece, per platform, at ages 1, 3, 7 and 14 days**: the first
  snapshot at or after that age, so a missed night costs a day's precision
  and never a row. Rates from `metrics.ts`: saves plus shares per thousand
  views where views exist (Instagram, YouTube, TikTok, Threads); replies plus
  reposts plus quotes per post on Bluesky; comments per thousand views; watch
  percentage (average watch time over the piece's measured length) and skip
  rate where they exist; share, save and comment rates as Instagram defines
  them; replies that quote the hook. The like rate is listed, never ranked.
  Funnel by tag: circles made, plans shared, confirmed, raw, never as a
  rate; the numbers are small and a rate would lie.
- **The first 48 hours**: from `series.jsonl`, views at 2, 6, 12, 24 and 48
  hours, and the hour the curve bent, if it did. From `hand.jsonl`, the
  retention curve's tenths and the view sources, beside the piece's own
  slide timings, so "where people left" can be read against "which slide
  was on screen". That join is the one reason to transcribe the screens.
- **The account, by day**: follower and non-follower reach, views by
  surface, follower count, link taps, as context lines in `scorecard.md`;
  the scorecard never attributes an account-level number to one post.
- **Lift**: each piece's day-7 rate divided by the running median of every
  piece on that platform at day 7. This is the number families, shapes,
  archetypes and features are compared on, so platform differences never
  masquerade as content differences.
- **By family, shape, archetype, platform, publish hour, weekday, and each
  feature split**: median lift and n. Anything with n under three is listed
  under "too early" and ranked nowhere.
- **The control arm**: the first `experiments.md` row compares story-first
  shapes with `demo-first`; the scorecard reports that comparison by name
  for as long as the row is live.
- `scorecard.md` is the dashboard. There is no other.

## Brief and drafting

`npm run brief` writes `../context/learned.md` from `scorecard.json`. The
file is short on purpose and every line carries its evidence:

```
# Learned

Generated by npm run brief on 2026-11-18 from analytics/scorecard.json.
Never edit by hand; the next nightly run overwrites it.

## Do more of
- pm family, quote-led shape: lift 1.6 on instagram (n=4, day 7)
- hooks with a number: lift 1.4 across platforms (n=6 vs 5)

## Stop
- three chats before the beat: lift 0.6 (n=3 vs 7); two is enough

## Too early
- rhythm family (n=2), tetris shape (n=1), posting after 8 pm (n=2)

## Windows
- instagram: 6–7 pm Melbourne posts lead (n=5); bluesky: no difference seen

## Replies
- "it's always you" quoted back 4 times; "sorry guys" 2 times
```

Where it is read:

- `/hooks` and `/skit` read it after `voice.md`, `facts.md` and `hooks.md`:
  prefer what "Do more of" names for this family, avoid what "Stop" names,
  treat "Too early" as no information. The skill text says so in one
  paragraph; the brief never overrides a rule in those three files, and it
  can never add a claim.
- `/daily` is unchanged in how it picks the family (fewest pieces this
  fortnight) because `experiments.md` is the authority on what is live; the
  retro is what changes that.
- `/review` gains one check: a queue file may not cite `learned.md` as a
  source for a claim.

## Retro

Fortnightly, aligned to the rows of `experiments.md`.

- `npm run retro [-- --fortnight 2026-10-20]` prints the filled table rows for
  every live family in that fortnight (Pieces, Views, Saves+shares /1k,
  Circles made, Plans shared) from the scorecard, as markdown, keyed by the
  row's first two cells.
- `/retro`, a new skill: runs it, pastes the rows into `experiments.md`
  verbatim, writes Result (supported, refuted, too early) and Next for each
  row from `scorecard.md`, proposes the next fortnight's rows (which families
  stay live, which shapes rotate, whether the control arm continues), and
  opens a PR titled `content: retro <fortnight>`. It never edits `context/`
  and never sets a row's Result to anything the scorecard does not show. On
  day 30 of a family it applies the standing rule, kill the two worst and
  double the best, as a proposal in the same PR.
- A second Routine runs `/retro` every fourteen days, the morning after a
  row ends. Merging the PR is the decision.

## The Wenna export

The one piece that lives outside `content/`, worked as a ticket in the main
repo under the usual gate.

**ADR 0087: "The content loop reads the funnel by tag through a keyed
export, counts only."** (0086 is the YouTube and TikTok record.) Context:
the loop runs nightly and `founder_analytics` is `auth.uid()`-gated, so no
script can read `by_source_ref` without a founder's session, and a founder's
session in CI means a rotating refresh token in GitHub. Decision: a SQL
function and an internal Edge Function, below. Alternatives: the founder's
session in CI (rotating tokens, a person's credential in a bot); the
service-role key in GitHub (every table, for one read); a `pg_cron` dump to
a private bucket (a second credential and storage for a copy of what a view
computes); a weekly hand export (the step everyone skips in week three).
Consequences: a secret beside the deploy credentials this repository already
holds; counts by tag land in a public repository, which `experiments.md`'s
"Plans shared" column already intended; deleting the secret turns the door
off.

- **`analytics.source_ref_export(p_since date) returns jsonb`**: the
  `by_source_ref` and `stalled` blocks of `founder_analytics`, factored into
  a function both call so there is one definition (ADR 0015: one file per
  function, generated into the migration). `security definer`, `set
  search_path = ''`, executable by `service_role` only, revoked from `anon`
  and `authenticated`. The period clamps to 400 days as the founder function
  does. The result has the same shape as `SourceRefNumbers` and `StalledRow`
  in `packages/contracts`, filtered to the `content` source for stalled rows.
- **`content-funnel`**, an internal Edge Function on `internalHandler` with
  one change: the handler takes the name of its secret, so this one reads
  `CONTENT_FUNNEL_SECRET` and not `CRON_SECRET`. The content loop's secret
  must not be able to run the job processor. POST only, body `{ since }`,
  401 for everything until the secret is set, a rate limit from
  `take_rate_token` of a few calls an hour, no log line beyond the status.
  `verify_jwt = false` in `config.toml` as for the other internal functions;
  architecture §9.1 lists it as internal.
- **Tests**: pgTAP that `service_role` can call it, `anon` and
  `authenticated` are refused, and the result contains no uuid, no plan
  code, no name (the same assertions `380_founder_analytics.sql` makes);
  `handlers.test.ts` for the bearer check and the 405 on GET; a contract
  test that the shape parses as `SourceRefNumbers`.
- **Docs**: `docs/runbooks/campaign-links.md` gains "Read it from the content
  loop"; `docs/technical-architecture.md` lists the function; the spec is
  untouched because no product rule changes.
- **On this side**: `analytics/platforms/wenna.ts` POSTs with the secret
  from `CONTENT_FUNNEL_SECRET` to `WENNA_FUNNEL_URL` (prod), writes
  `funnel.jsonl`, and the scorecard joins by `from`.

Definition of done for the ticket: the ADR, the migration with its tests, the
function with its tests, the runbook line, and a dry run from a laptop with
the secret set showing counts by tag and nothing else.

## Workflows and secrets

`content-analytics.yml` grows into the nightly chain and gains the secrets:

```
npm run analytics      # pull posts, funnel, replies; measure unmeasured pieces; auto-claim
npm run scorecard
npm run brief
git add analytics inbox context/learned.md queue published publish
```

Secrets added to the repository: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
`YOUTUBE_REFRESH_TOKEN` (already there for the publisher), `YOUTUBE_API_KEY`,
`CONTENT_FUNNEL_SECRET`, later `TIKTOK_*`; and two repository variables,
`YOUTUBE_CHANNEL_ID` (needed for the account row and auto-claim while only
the API key is set; open point 3) and `WENNA_FUNNEL_URL`. The Threads and
Instagram tokens are already there. `IG_USER_ID`, `THREADS_USER_ID` and
`BSKY_HANDLE` are repository variables, not secrets: each is an account
identifier, public on every post and written into the committed raw rows.
The job keeps `contents: write` and still touches only `content/**`, so
ADR 0081's promise holds: these commits run nothing else.

A second schedule, `content-series.yml`, runs `npm run analytics --
--series` every two hours and commits only when it has rows, which is only
while a post is under 48 hours old. With one piece a day that is a dozen
small bot commits a day on `main`, all under `content/`, all harmless to the
gate (ADR 0081). If that is too noisy, the alternative is for each run to
upload its rows as a workflow artifact and the nightly job to fold the day's
artifacts into `series.jsonl` in one commit; decide after the first week.

`content-publish.yml` is unchanged: `npm run video -- --approved` already
runs there and now writes `timing:`. The Routine that runs `/daily` sees
`learned.md` and the inbox on its clone of `main`; it needs no token. The
`/retro` Routine needs none either. `/transcribe` runs wherever the founder
drops the screenshots, which is a laptop, and needs no token.

**Checks.** `content-check.yml` runs `npm run typecheck` and `npm test` on
Node 22 for any change under `content/`, on a pull request and on `main`;
the folder is outside the pnpm gate (ADR 0081), so this is its one check,
and it makes no network call and needs no secret.

Failure modes, in order of likelihood: a token expires (the run fails loudly,
`npm run tokens` fixes it in a minute); a platform renames a metric (the raw
column keeps the history, `metrics.ts` maps the new name); a hand post is
never claimed (it shows in `scorecard.md` under "published but unmeasured"
until `npm run posted`); the export secret is unset (funnel columns stay
blank and the scorecard says "not configured", never zero).

## Phases

Each phase is a PR, or a ticket in the main repo where it says so. Phase 1
and 2 are useful with no funnel at all; phase 3 runs in parallel in the main
repo.

**Phase 0: ground truth** (done 21 October). The probe ran; the table above
is corrected from it. What it leaves to do before phase 1 can read every
platform: a Threads long-lived token (`threads_basic`,
`threads_manage_insights`, `threads_read_replies`); a YouTube re-consent that
adds `youtube.readonly` and `yt-analytics.readonly` to the upload scope, or
a plain API key for the public numbers meanwhile; and, if Instagram comments
are wanted, `instagram_business_manage_comments` on the next Instagram token.
None of these blocks phase 1: a platform without a token is skipped and says
so.

**Phase 1: pull, complete.** `analytics/platforms/*`, the common row and
`metrics.ts`, `age_days`, `raw` kept whole, `account.jsonl` with every
breakdown the probe confirmed, `series.jsonl` and its two-hourly workflow,
auto-claim for YouTube, `npm run posted`, `npm run hand`, `/transcribe` with
`inbox/screens/` git-ignored, `npm run tokens`, replies into `inbox/` with
`replies-seen.json`, the nightly workflow with the new secrets, `README.md`
and `CLAUDE.md` updated (the loop gains steps 6 and 7; the Files table gains
the new files). Done when a night with one published piece on four platforms
produces four rows with their raw payloads, the account row carries the
follower split, the Short is claimed by its tag, a reply appears in `inbox/`
with no handle, and one transcribed screen lands in `hand.jsonl`.

**Phase 2: measure, score, brief.** `lib/measure.ts` with `check.ts` on top
of it, the video build's `timing:` write, `features.jsonl`, `scorecard.ts`,
`brief.ts`, `/hooks` and `/skit` reading `learned.md`, the `/review` check,
`experiments.md`'s columns revised. Done when `npm run scorecard` on a
fixture set of six pieces produces a `scorecard.md` a person can read in two
minutes, every aggregate carries its n, and nothing under n=3 is ranked.

*Phase 2, as built.* Where the text above left a choice:

- A snapshot "at day N" is the first at or after N and before the next age
  compared (day 14's window is a week), so a day-1 number is never read off
  day 9; within the window, the first that carries the platform's headline
  rate, so a transcribed screen never hides the typed views beside it.
- "48 h" in the first 48 hours is the last series row from 42 hours on:
  the pull stops polling at 48, so no row is ever at or after it.
- No lift until a platform has three pieces at day 7. A median of one is
  the piece itself, a lift of exactly 1 that would count in every group.
- Each piece counts once in an aggregate, as the median of its platform
  lifts; n, the median and the spread are all over pieces.
- Hand numbers stand in for a platform only where the pull has no row
  (TikTok), aged from the ledger's `posted` row; a transcribed screen on a
  platform the pull reads is shown beside it, never scored.
- `features.jsonl` gains a row when a piece's measure changes (its
  `timing:` arrives, a platform's post time lands in the ledger), not only
  when it has none; the scorecard reads the last row per slug.
- Lift is by platform; there is no group "by platform", which would be each
  platform's median over itself. Groups are family, shape, archetype,
  posting hour (one-hour windows in Melbourne, from the ledger's post time)
  and weekday, each with its per-platform medians.
- A split is reported when both sides have three pieces and the gap between
  their median lifts is wider than the larger median absolute deviation
  within them. A split with no piece on one side is "no contrast yet", not
  "too early".
- The brief's thresholds: "Do more of" at a median lift of 1.2 or more,
  "Stop" at 0.8 or less; a split goes in when its leading side clears 1.2
  or its trailing side 0.8, under "Stop" when the side without leads; eight
  lines a section, sixty in all.
- The scorecard and the brief are dated by the Melbourne day of the run.

**Phase 3: the Wenna export** (main repo, one ticket: SUS-244). ADR 0087, the SQL
function and migration, `content-funnel`, tests, runbook; then `wenna.ts`
and `funnel.jsonl` here. Done when the nightly run writes circles made and
plans shared by tag into `funnel.jsonl` and the scorecard shows them.

**Phase 4: retro.** `npm run retro`, the `/retro` skill, its Routine, the
day-30 rule as a proposal. Done when the first fortnight's rows are filled by
a PR nobody typed numbers into.

*Phase 4, as built.* `npm run retro` writes the number cells only, and
only with `--write`; it prints the rows either way. A row's pieces are its
family's pieces whose first post (the ledger's, Melbourne day; a TikTok
draft is not a post) falls inside the fortnight. Views (TikTok) is the sum
of the latest TikTok views with n, Saves+shares /1k the median day-7 rate
per platform with n (or "too early"), and Circles made and Plans shared stay
blank until phase 3. With no `--fortnight` it takes the latest fortnight
that has ended and refuses when none has; an explicit one may be running,
and says so. A row it cannot rebuild cell for cell is refused before
anything is written. Day 30 is counted from the first row a family appears
in (its start is day 1) and is due at the last retro before it, for the
families with a row in the fortnight: with rows starting 20 October, that
is the 17 November retro, for day 30 on the 18th. The script prints the
day-7 lift by family with n; the kill-two, double-one proposal is the
skill's, never the script's, and shrinks with fewer than three ranked
families: with two, double the higher and kill the lower only at or under
the brief's "Stop" bar (`LAG` in `analytics/brief.ts`, 0.8 today); with one or none, propose nothing; never
kill and double the same family. A row is filled once, the morning after its fortnight ends, so
a piece from its second week is not yet seven days old and is not in its
day-7 median; the n says so, and the scorecard keeps the later number. The Routine is set
up by hand in Claude Code (README, setup step 6).

**Phase 5: later, by evidence.** TikTok's Display API once views are the
number that decides anything (it is the headline metric in `experiments.md`,
so this may come sooner); LinkedIn post analytics if LinkedIn is ever more
than a text channel; Reddit read-only. Each is one module in
`analytics/platforms/` and one secret.

## Open points

1. **The repository is public.** Platform numbers are public already;
   circles made and plans shared by tag are not. `experiments.md` intended
   them in the repo and this plan follows it. The alternative is a
   git-excluded `analytics/private/` like `docs/audits/`, which the nightly
   bot cannot then persist; it would need a private bucket. Decide before
   phase 3 ships.
2. **Instagram comments** need `instagram_business_manage_comments` on the
   token; the probe read them with the current token, so the permission is
   present. The refresh keeps the scopes it was issued with.
3. **YouTube** reads nothing today: the refresh token has `youtube.upload`
   only. Phase 1 ships with an API key for the public numbers and comment
   text, with `YOUTUBE_CHANNEL_ID` beside it (a key alone cannot say whose
   channel it is, and the account row and auto-claim need to know), and
   the retention metrics (watch percentage, traffic source) wait for a
   re-consent that adds `youtube.readonly` and `yt-analytics.readonly`.
   The same sign-in carries all three scopes; the publisher's adapter keeps
   working with it.
3a. **Threads** needs its OAuth sign-in before any Threads row exists. The
   publisher is in the same position, so this was true before this plan.
3b. **The one pre-loop hand post** (Bluesky, 16 October) carries no tag and
   no ledger row. `npm run posted` can claim it against its queue file so
   the first scorecard is not empty, or it stays out as a pre-loop post.
   Decided 22 October: it stays out, as a pre-loop post.
4. **`experiments.md` columns.** Replace "Link taps" with "Circles made";
   keep "Plans shared"; add "Happened" later when the north star can be read
   by tag. The metric sentence at the top changes with it.
5. **Hook-quoted replies** are matched by words, which will miss paraphrase
   and catch coincidence. Good enough for a count; `/mine` reads the text
   anyway.
6. **The before and after split** is a rule in `check.ts` and a feature
   here. If a `demo-first` piece ever wins, the rule becomes an experiment
   result, which is what the control arm is for.
7. **Transcription is a judgement call per piece.** A screenshot of a
   retention curve is twelve numbers read off a line by eye; the skill
   records them as read and marks the row `by: transcribed`, and the
   scorecard shows that mark. Worth doing for the pieces that decide a
   fortnight, not for every post.
8. **`reposts` per Reel** does not exist in the API on any version; the
   account-level daily count is what there is, and the scorecard shows it
   as an account line, never per post.

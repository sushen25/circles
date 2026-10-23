# content

The content loop for Wenna ("Plans with friends", wenna.app), living in the
Circles monorepo under `content/` (ADR 0081). Claude drafts, a human merges, a
script publishes. Nothing here posts on its own.

This folder is its own npm project: run every command below from `content/`
with `npm`, not `pnpm`. The repo's gate (`pnpm check`) does not read it; its
own check is `npm run check`. Renders in `out/` are never committed.

Read `context/voice.md`, `context/facts.md` and `context/hooks.md` before
writing anything a person will read. They are short and they are the law.

## The loop

1. `/mine` — lift verbatim phrases from anything people wrote (Reddit,
   forums, Hacker News, app reviews, replies, DMs, comments) into
   `context/hooks.md`. Phrases are quoted, never invented. Given only a
   family, it first searches every source `docs/listening.md` marks as
   readable and returns what is worth lifting; Reddit comes in as pages the
   founder pastes.
2. `/hooks` — turn one hook family into 6–8 candidate hooks (first line of a
   slideshow or post).
3. `/skit` — write one group-chat skit as `queue/YYYY-MM-DD-<slug>.md`, in
   one named shape built from `render/components/`: frontmatter, the skit
   JSON, and a platform-native caption for every channel (tiktok,
   instagram, threads, bluesky, linkedin, youtube).
4. `/review` — after `npm run check queue/<file>.md` passes, a reviewer pass
   that cannot edit: it returns PASS or a list of fixes. Run it before any
   queue file is committed.
5. `/daily` — the Routine entrypoint: runs 1–4 for one day, writes one queue
   file with `status: draft`, opens a PR on a `claude/` branch.
6. `npm run analytics` — the nightly pull, run by `content-analytics.yml`:
   every published post's numbers into `analytics/posts.jsonl`, the account
   by day into `account.jsonl`, and new replies into `inbox/<date>-replies.md`
   with the handles stripped, which is step 1's input the next morning. It
   reads only; nothing it does posts. After it, `npm run scorecard` builds
   `analytics/scorecard.md` (the dashboard) from every row, and
   `npm run brief` rewrites `context/learned.md` from that, which `/hooks`
   and `/skit` read the next morning.
7. `npm run posted -- …`, `npm run hand -- …` and `/transcribe` — the
   founder's weekly minute, on a laptop: `npm run posted -- <platform>
   <slug> <url-or-id>` records a hand post's id (a TikTok draft once posted,
   a Short uploaded by hand), `npm run hand -- tiktok <slug> views=1240
   saves=18 shares=9` records the TikTok numbers, and `/transcribe` reads
   the Insights screens dropped into `inbox/screens/<slug>-<platform>/`.
   Nothing in it posts.
8. `/retro` — fortnightly, the Routine's other entrypoint: `npm run retro
   -- --write` fills the ended fortnight's number cells in `experiments.md`
   from the scorecard, the skill writes Result and Next from
   `scorecard.md`, proposes the next fortnight's rows (and, on day 30, the
   kill-two-double-one proposal) and opens one PR. Merging it is the
   decision.

Merging the PR is approval. `npm run publish` (or the GitHub Action on merge)
publishes anything in `queue/` with `status: approved` and moves it to
`published/`.

**The bots never push to `main`** (it is protected; ADR 0089). The three
workflows commit to the `content-data` branch and keep one pull request open
from it, which the founder merges (README, "Where the bots' work goes"). A
run starts from that branch, so it sees ledger lines that are not on `main`
yet; `main` is behind by up to the founder's merge cadence. Never add a
`git push` to a workflow: `lib/databranch.ts` is the only thing that pushes,
and `check:workflows` fails a workflow that does it itself. The publisher
records a tag `content-attempt/<platform>/<slug>` before every post and posts
nothing while a tag has no ledger row; do not remove that guard, and do not
retry a failed post by clearing the tag without looking at the platform.

**Who posts where** (ADR 0086; this is the one place the rule is written, and
`publish/guards.ts` enforces it as `SCRIPTABLE` and `DRAFT_ONLY`):

| Platform | The script | The founder |
|---|---|---|
| Bluesky, Threads, Instagram, LinkedIn | posts | merges |
| YouTube | uploads the MP4 as a Short, private, and prints its Studio link | merges, then sets it Public (or schedules it) in Studio; once the API project is audited, `YOUTUBE_PRIVACY=public` drops that step |
| TikTok | sends a draft to the TikTok inbox, never posts; logged `drafted` | reads it, picks a sound, taps Post |
| Reddit | nothing | writes and posts it by hand |

## Non-negotiables

- **One mention of the product per piece, at most.** Most pieces are a story
  about the problem; the product is the last slide, not the first.
- **No claims outside `context/facts.md`.** A number, a feature, a comparison
  or a quote that is not in facts.md gets `[VERIFY]` in the draft and the
  reviewer fails it.
- **Fictional chats are obviously fictional.** First names only, no surnames,
  no real phone UI chrome, no real people's photos, no AI-generated faces.
- **Platform-native rewrites, never identical text.** Bluesky, Threads,
  Instagram and LinkedIn captions differ in length, register and link
  placement. The same sentence on two platforms is a reviewer fail.
- **Nothing is scheduled for the same minute every day.** The publisher
  jitters; drafts set `publish_at` to a window, not a minute.
- **Reddit stays human, and TikTok is only ever a draft.** See "Who posts
  where". Never write a Reddit post that could be pasted without the founder
  reading it first; never use TikTok's Direct Post.
- **No exclamation marks, no emoji, no urgency, no guilt.** See voice.md.
- **Links are written plain and tagged on the way out.** A caption says
  `wenna.app`; the publisher turns it into `wenna.app/?from=<platform>-<slug>`
  (`lib/links.ts`), prints the same for what the founder posts by hand, and
  records the tag in the ledger. Never type `?from=` into a queue file
  (`npm run check` fails it). The tag names the post, never a person.
- **Counts and text, never people.** The pull keeps numbers and reply text.
  It strips every handle, username and profile link before anything is
  written, drops the author of a reply and the account's own replies inside
  the platform module, and never pulls a follower list or a DM. The brief
  it feeds (`context/learned.md`) says what worked; it can never add a
  claim to `facts.md`.

## Files

| Path | What |
|---|---|
| `context/` | positioning, voice, allowed facts, hook phrases. Edit by hand or via `/mine`. `learned.md` is the exception: the brief `npm run brief` writes nightly from the scorecard, never edited by hand and never a source for a claim. |
| `queue/` | one markdown file per piece. `status: draft` → `approved` (by merge) → moved to `published/`. |
| `render/` | `npm run render queue/<file>.md` writes 1080x1920 PNGs (and a JPEG of each, for TikTok) and a `contact.png` strip to `out/<slug>/`; `npm run video queue/<file>.md` writes the same skit as a 9:16 MP4 (needs ffmpeg). `-- --approved` does every approved slideshow, for either: what the Action runs before publishing. |
| `publish/` | `npm run publish` posts approved queue items (TikTok as a draft), the MP4 wherever one is rendered (LinkedIn excepted); `npm run dry-run` prints what it would do; `npm test` checks the adapters' request shapes and, in `run.test.ts`, that no failure mode posts twice. Guards live in code, not prompts. `npm run auth:youtube` / `auth:tiktok` are the one-time sign-ins. |
| `lib/databranch.ts` | the data branch and the attempt tags: `sync`, `save`, `open-pr`, `begin`. `npm run attempt -- attempts \| clear <platform> <slug>`. The only code that pushes. |
| `lib/links.ts` | the link tag: `wenna.app/?from=<platform>-<slug>`. The publisher applies it; Wenna reads it on the circle's founder-only cohort row (circles SUS-240). |
| `analytics/` | `platforms/` is one read-only module per platform, the way `publish/adapters.ts` is one function per platform. `npm run analytics` appends to `posts.jsonl` (a row per post per platform per night, the platform's answer whole in `raw`), `account.jsonl` (the account by day) and, with `--series`, `series.jsonl` (every two hours for a post's first 48 hours); `replies-seen.json` is which replies have already gone to `inbox/`. `hand.jsonl` is what a person typed or read off a screen. `npm run posted` records a hand post's id; `npm run hand` records its numbers; `npm run tokens` reports and renews the tokens. The pull also appends `features.jsonl` (what each published piece is, `lib/measure.ts`) for any piece whose measure is new. `npm run scorecard` writes `scorecard.json` and `scorecard.md` (age-matched rates, lift against the platform median, aggregates with their n; `aggregates.ts`), `npm run brief` writes `../context/learned.md`; one definition per rate, in `metrics.ts`. |
| `lib/measure.ts` | a queue file's features (hook, slides, chats before the beat, captions per platform, Melbourne post hour) and its timing; `npm run check` and `npm run video` measure with it, and the video build writes `timing:` into the frontmatter. |
| `inbox/` | what the loop reads next: `<date>-replies.md` from the nightly pull (handles stripped) for `/mine`; `screens/<slug>-<platform>/` for `/transcribe`, git-ignored; `done/` is where both go once read. |
| `docs/analytics-plan.md` | why the analytics are shaped as they are: the principles, the data model, what each platform can give, the phases. Read it before changing anything under `analytics/`. |
| `docs/listening.md` | where the loop listens: every source, how to read it, which ones turn AI agents away, the Reddit paste-back kit, and the rules for all of them. Read it before a listening pass or a `/mine` search. |
| `experiments.md` | hypothesis · format · hook family · result · next. One row per fortnight per family. The number cells are written by `npm run retro`, Result and Next by `/retro` or a person. |

## Commands

```
npm run render queue/2026-10-14-unpaid-project-manager.md     # PNGs to out/
npm run video  queue/2026-10-14-unpaid-project-manager.md     # MP4 to out/ (ffmpeg)
npm run check  queue/2026-10-14-unpaid-project-manager.md     # schema, seconds per slide, product mentions
npm run gallery [type...]                                     # every component's fixture to out/gallery/
npm run upload queue/2026-10-14-unpaid-project-manager.md     # renders to media.wenna.app (AWS CLI)
npm run publish                                               # approved items only
npm run dry-run                                               # prints what publish would do
npm test                                                      # adapter request shapes, nothing sent
npm run auth:youtube                                          # once: prints YOUTUBE_REFRESH_TOKEN
npm run auth:tiktok                                           # once: prints TIKTOK_REFRESH_TOKEN
npm run refresh:tokens -- --github                            # monthly: renews the Threads and Instagram tokens
npm run analytics                                             # pull metrics for published items
npm run analytics -- --series                                 # every two hours: posts under 48 hours old, to series.jsonl
npm run posted -- tiktok unpaid-project-manager <url-or-id>   # record a hand post's id; --at <iso> when the platform cannot say
npm run hand -- tiktok unpaid-project-manager views=1240      # weekly TikTok numbers (saves=18 shares=9 ...), to hand.jsonl
npm run tokens -- --github                                    # monthly: every token's state; renews and writes the Meta ones
npm run measure queue/2026-10-20-never-lead-anywhere.md       # a piece's feature row; -- --timing builds it and writes timing:
npm run scorecard                                             # analytics/scorecard.json and scorecard.md from every row
npm run brief                                                 # context/learned.md from the scorecard
npm run retro -- [--fortnight 2026-10-20] [--write]           # a fortnight's experiments.md number cells, from the scorecard
npm run typecheck                                             # tsc over analytics/ and lib/measure.ts, nothing emitted
```

Node 22, no build step: scripts run with `node --experimental-strip-types`.

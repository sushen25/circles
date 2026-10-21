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

1. `/mine` — lift verbatim phrases from Reddit replies, DMs and comments into
   `context/hooks.md`. Phrases are quoted, never invented.
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

Merging the PR is approval. `npm run publish` (or the GitHub Action on merge)
publishes anything in `queue/` with `status: approved` and moves it to
`published/`.

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

## Files

| Path | What |
|---|---|
| `context/` | positioning, voice, allowed facts, hook phrases. Edit by hand or via `/mine`. |
| `queue/` | one markdown file per piece. `status: draft` → `approved` (by merge) → moved to `published/`. |
| `render/` | `npm run render queue/<file>.md` writes 1080x1920 PNGs (and a JPEG of each, for TikTok) and a `contact.png` strip to `out/<slug>/`; `npm run video queue/<file>.md` writes the same skit as a 9:16 MP4 (needs ffmpeg). `-- --approved` does every approved slideshow, for either: what the Action runs before publishing. |
| `publish/` | `npm run publish` posts approved queue items (TikTok as a draft), the MP4 wherever one is rendered (LinkedIn excepted); `npm run dry-run` prints what it would do; `npm test` checks the adapters' request shapes. Guards live in code, not prompts. `npm run auth:youtube` / `auth:tiktok` are the one-time sign-ins. |
| `lib/links.ts` | the link tag: `wenna.app/?from=<platform>-<slug>`. The publisher applies it; Wenna reads it on the circle's founder-only cohort row (circles SUS-240). |
| `analytics/` | `npm run analytics` appends a row per post per day to `posts.jsonl`. |
| `experiments.md` | hypothesis · format · hook family · result · next. One row per fortnight per family. |

## Commands

```
npm run render queue/2026-10-14-unpaid-project-manager.md   # PNGs to out/
npm run video  queue/2026-10-14-unpaid-project-manager.md   # MP4 to out/ (ffmpeg)
npm run check  queue/2026-10-14-unpaid-project-manager.md   # schema, seconds per slide, product mentions
npm run gallery [type...]                                  # every component's fixture to out/gallery/
npm run upload queue/2026-10-14-unpaid-project-manager.md   # renders to media.wenna.app (AWS SDK)
npm run publish                                            # approved items only
npm run dry-run                                            # prints what publish would do
npm test                                                   # adapter request shapes, nothing sent
npm run auth:youtube                                       # once: prints YOUTUBE_REFRESH_TOKEN
npm run auth:tiktok                                        # once: prints TIKTOK_REFRESH_TOKEN
npm run refresh:tokens -- --github                         # monthly: renews the Threads and Instagram tokens
npm run analytics                                          # pull metrics for published items
```

Node 22, no build step: scripts run with `node --experimental-strip-types`.

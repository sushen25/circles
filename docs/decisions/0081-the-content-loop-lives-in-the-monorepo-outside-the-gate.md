---
adr: 81
title: "The content loop lives in the monorepo under content/, outside the gate"
status: accepted
date: 2026-10-20
---
# ADR 0081: The content loop lives in the monorepo under content/, outside the gate

_Status: accepted · 20 October 2026_

## Context

The content loop (skits drafted by Claude, merged by the founder, published by a
script; Reddit and TikTok posted by hand) lived in its own repository,
`sushen25/wenna-content`. It is the second place a founder working alone had to
look, and the link tags it now stamps on every post (`wenna.app/?from=<platform>-<slug>`)
are read on this side, by the circle's founder-only cohort row, so the two had
started to depend on each other.

Two things about that repository do not fit here as they were. It tracked its
renders in git (`out/`, 1.5 GB and growing, because Threads and Instagram fetch
media by URL and the repository was the host), and its bot committed to `main`
after every publish. Here, a push to `main` runs the gate and deploys dev, and
the gate takes thirty minutes.

## Decision

The content loop moves to `content/` in this repository, as a fresh copy. Its
history stays in the archived `wenna-content` repository.

`content/` is its own npm project, outside the pnpm workspace. It keeps its own
`CLAUDE.md`, skills, `npm run check` and formatting. The gate does not open it:
`ci-scope` treats `content/` as prose, Prettier, ESLint and `check:brand` skip
it, and `deploy-dev` and `preview` ignore it. `check:workflows` still reads its
two workflows, and gitleaks still scans every commit, so a token pasted into a
caption is caught the same way as one pasted into a doc.

Renders are not tracked. `content/out/` is git-ignored and regenerated on
demand; published media is served from `MEDIA_BASE_URL` (a bucket), never from
this repository. Until that variable is set the publisher skips the two
platforms that fetch by URL, as it did before.

The bot commits to `main`, touching only `content/**`, from two workflows:
`content-publish` (on a push that changes the queue, and on an evening
schedule) and `content-analytics` (nightly). Because `content/**` is prose to
the gate and ignored by the deploys, those commits run nothing else.

## Alternatives considered

- **A git submodule or subtree.** One checkout, still two repositories to
  think about, and the subtree would have imported the render blobs.
- **Bringing the renders along.** Every clone and CI checkout 1.5 GB heavier,
  growing with every piece, and media commits landing on the app's `main`.
- **A `content` branch for the bot.** Keeps `main` untouched by the bot at the
  cost of a merge nobody would remember to do; the path filters make the
  commits harmless where they are.
- **Making `content/` a workspace package.** Its TypeScript runs on Node's
  strip-types loader with `.js`-suffixed imports and a Playwright renderer;
  pulling it under `tsc -b`, ESLint's boundaries and Prettier would mean
  reshaping a working tool for no check that matters to the app.

## Consequences

- One repository. `cd content && npm i` is the setup; `content/README.md` has
  the rest. The Claude Code Routine that runs `/daily` clones this repository
  and works in `content/`.
- The platform secrets (`BSKY_*`, `THREADS_*`, `IG_*`, `LINKEDIN_*`) and the
  `MEDIA_BASE_URL` variable move to this repository's settings. Until they are
  set, the workflows run and post nothing, and say so.
- A change under `content/` never runs the suites. If something under
  `content/` ever needs to share code with the app (the link-tag rule, say), it
  moves into `packages/` and the rule here is revisited.
- `check:brand` does not read `content/`; prose may name the product.

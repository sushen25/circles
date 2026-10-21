---
adr: 86
title: "YouTube is published by script, and TikTok is scripted only as far as a draft"
status: accepted
date: 2026-10-21
amends: [81]
---
# ADR 0086: YouTube is published by script, and TikTok is scripted only as far as a draft

_Status: accepted · 21 October 2026 · amends [ADR 0081](0081-the-content-loop-lives-in-the-monorepo-outside-the-gate.md)_

## Context

The content loop moved into `content/` under ADR 0081 with one rule carried
over from its old repository: a script publishes Bluesky, Threads, Instagram
and LinkedIn; TikTok, YouTube and Reddit are posted by hand. Each piece already
renders as a 9:16 MP4 (`npm run video`) with a YouTube title and a TikTok
caption in its queue file, so hand posting means carrying the same file to
two apps every day.

What the two platforms allow, as read on 21 October 2026:

- **YouTube.** The Data API's `videos.insert` with the `youtube.upload` scope
  uploads a Short; there is no draft mode to choose instead. Uploads from an
  API project Google has not audited are locked to private whatever is asked
  for, until the project passes Google's API compliance audit. A refresh
  token from a consent screen left in "Testing" expires after seven days.
- **TikTok.** The Content Posting API has two modes. Direct Post
  (`video.publish`) posts as the account, and until TikTok's audit it posts
  private-only; the audit expects a real posting interface (creator info, a
  privacy picker). Upload mode (`video.upload`, `post_mode: MEDIA_UPLOAD`)
  puts the video or photo carousel in the creator's TikTok inbox as a
  draft; the creator opens it, adds a sound and posts it in the app.
- **Reddit.** Unchanged: every subreddit has its own rules, and a post the
  founder has not read is the failure the loop exists to prevent.

## Decision

The rule for which platforms a script may touch lives in one place,
`content/CLAUDE.md`, and in code in `content/publish/guards.ts`
(`SCRIPTABLE`, `DRAFT_ONLY`). It is now:

- **YouTube is scriptable.** Merging the queue file approves it like the
  other four. The publisher uploads `out/<slug>/<slug>.mp4` as a Short with
  the caption's `title:` as the title and the tagged text as the description.
  Its privacy comes from `YOUTUBE_PRIVACY` and defaults to `private`, so
  nothing goes public until the API project is audited and the founder
  changes the variable.
- **TikTok is scripted as far as a draft, and a human posts it.** The
  publisher uses upload mode only, never Direct Post: the JPEG stills (by
  URL from the verified `MEDIA_BASE_URL` domain) or the MP4 land in the
  founder's TikTok inbox. The founder reads it, picks a sound and taps Post.
  The ledger and the console say "drafted", not "posted", and record the
  `publish_id`.
- **Reddit stays human.** Draft only, as before.

Both new credentials come from a one-time local sign-in
(`npm run auth:youtube`, `npm run auth:tiktok`) that prints a refresh token
for `.env` and the repository's secrets. Neither platform's audit is a
precondition for merging this: YouTube uploads stay private and TikTok
drafts are private to the inbox until the founder acts.

## Alternatives considered

- **TikTok Direct Post.** Removes the last tap, and with it the founder's
  last read and the sound choice, which is most of what a TikTok post is.
  It also cannot ship before an audit that wants a posting interface this
  loop does not have.
- **Keeping YouTube by hand until the audit passes.** Private uploads are
  harmless, and having them land means the audit form can point at a working
  integration; switching to public is then one variable.
- **The `googleapis` client.** One resumable upload and one token refresh are
  three `fetch` calls; the client is tens of megabytes for that.
- **TikTok photo posts from the PNGs.** TikTok's photo mode takes JPEG or
  WebP only, so the renderer writes a JPEG beside each PNG.

## Consequences

- `content/publish/` gains a YouTube and a TikTok adapter, two auth scripts
  and `npm test` for their request shapes. `content-publish.yml` passes the
  new secrets through; until they are set, the publisher skips both
  platforms as not configured, and the item stays in the queue for them.
- The founder's setup (Google Cloud project, consent screen in production,
  the YouTube API audit form; a TikTok developer app with privacy and terms
  URLs on wenna.app, the media bucket's domain verified, and the
  `video.upload` scope) is listed in the pull request that brings this in.
- A TikTok draft that the founder never finishes is invisible to the
  publisher: the ledger marks the piece drafted, and the inbox is where it
  waits.
- TikTok may rotate the refresh token on a refresh. Locally the publisher
  writes the new one into `.env`; in CI it says so and the secret needs
  updating by hand.

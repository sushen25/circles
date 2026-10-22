---
adr: 89
title: "The content bots commit to a data branch, and a tag makes a second post impossible"
status: proposed
date: 2026-10-22
amends: [81]
---
# ADR 0089: The content bots commit to a data branch, and a tag makes a second post impossible

_Status: proposed · 22 October 2026 · amends [ADR 0081](0081-the-content-loop-lives-in-the-monorepo-outside-the-gate.md), which had the bot commit to `main`_

## Context

ADR 0081 had the three content workflows (`content-analytics`, `content-series`,
`content-publish`) commit their data to `main` with the `GITHUB_TOKEN` and a
plain `git push`. `main` is now protected: a change needs a pull request and the
required check `check`. Every one of those pushes is rejected (`GH006`, run
39722895050, 22 October), so every analytics and series row is lost.

The publisher is the part that cannot wait. Its idempotency is the ledger and
the `published:` map, both read from the checkout. When it really posts and its
push is rejected, the next half-hourly run does not see the post and posts the
same piece again. It has not happened only because nothing approved has been
due since protection went on.

The founder's rule (22 October 2026): nothing commits directly to `main`, bots
included; every change goes through a pull request; protection is not bypassed
or loosened; merging stays the founder's, and nothing auto-merges.

Two facts about GitHub shape the design. A pull request opened, or a branch
pushed, with the `GITHUB_TOKEN` starts no `push` workflow, and its
`pull_request` workflows start held, waiting for someone with write access to
approve them, again after every push (GitHub's change of 11 June 2026, found on
the first data pull request), so the required `check` would never run on it
unattended; `workflow_dispatch` is the one trigger the token can fire that
runs at once. A dispatched run uses the dispatched branch's own workflow
files, and `gitleaks-action` scans every fetched branch on a dispatch, so
`check.yml` scans only `origin/main..HEAD` on one. And opening a pull request with the token needs the
repository setting "Allow GitHub Actions to create and approve pull requests",
which is off.

## Decision

**One long-lived data branch, `content-data`, and one pull request from it to
`main`.** Every content workflow starts a run by checking the branch out
(`content/lib/databranch.ts sync`): `main` if the branch does not exist or is
already merged, and otherwise the branch with `main` merged into it, so a run
sees every row, ledger line and `published:` id the earlier runs wrote that the
founder has not merged yet, and every queue file the founder has. It commits to
that branch and pushes it. A data commit is built on the branch's tip from the
tip's tree plus the files the run wrote, and nothing from `main`: GitHub
refuses a push made with `GITHUB_TOKEN` that changes `.github/workflows/`, and
`main` changes those most weeks, so the merge of `main` is never pushed. The
rows are `merge=union` in `content/.gitattributes`, so a human and a bot
adding lines to the same ledger do not conflict. It never runs `git push` to `main`, and no workflow
step runs `git push` at all: `databranch.ts` is the one place that pushes, to
`content-data` and to the attempt tags below. `check:workflows` holds both.

The first push of a run opens the pull request if there is none, and then
dispatches `check.yml` on the branch, because a push by the token starts
nothing. `check.yml` gains a `workflow_dispatch` trigger; a dispatch is judged
against `main` as a pull request is, and `content/` is prose to `ci-scope`, so
the `check` that reports on the branch's head is the cheap one (secret scan,
formatting, the docs check). That is the check branch protection waits for.

**The data needs the founder to switch one thing on, and does not depend on it.**
With "Allow GitHub Actions to create and approve pull requests" on, the pull
request opens by itself. With it off, the data is still on `content-data`, the
publisher still reads it from there, and the run prints a warning with the
compare link: the founder opens the pull request with one click. Nothing is
lost either way. Approval is never requested by the workflows; the branch
protection asks for none.

**A second post is made impossible by a lock outside the checkout.** Before the
publisher calls a platform it pushes a tag, `content-attempt/<platform>/<slug>`,
pointing at a commit of its own. A tag cannot be pushed twice, so of two runs
that both mean to post the same piece, only one creates it. Then:

- A run that cannot record the attempt (the remote is unreachable, the tag
  exists, the name is not a plain slug) posts nothing and fails.
- At the start of a real run, every attempt tag is compared with the ledger. An
  attempt with no ledger row behind it may be a post that went out and was never
  saved (the run was killed, its push was rejected, the branch was deleted
  unmerged). The publisher posts nothing, for any piece, and fails, until a
  person has looked at the platform and run `npm run posted -- <platform> <slug>
  <id>` or `npm run attempt -- clear <platform> <slug>`. A tag that cannot be
  listed is the same as one that is there.
- A failure from a platform's adapter leaves its attempt in place: the platform
  may have taken the post before the error. The run stops at it, even in the
  middle of a piece, and goes red; nothing else is posted in it.
- The ledger and ids are pushed to `content-data` straight after each piece,
  and again by a last step that runs even if the publisher failed. A push that
  is not a fast-forward is a red job, and the tag keeps the next run from
  posting.
- The three workflows share one concurrency group, `content-data`, with no
  cancellation, so they never write the branch, or post, beside each other.

## Alternatives considered

- **One pull request per run.** Each run branches from `main`, so a run does not
  see the previous run's ledger until the founder merges, and the publisher
  could post again in the half hour in between. Rejected for that reason alone.
  It also puts two to fourteen pull requests a day in front of the founder.
- **Data stored outside the repository** (a bucket, a database, Actions
  artifacts or cache). The ledger and the analytics rows are plain files that
  `content/` reads and tests; a second store is a second thing to back up, and
  the rows would no longer be reviewable. The attempt tag is the one piece of
  state kept outside the files, because it must survive the files.
- **A personal access token or a GitHub App**, which would open pull requests
  and start `check` with no setting and no dispatch. It is a new long-lived
  secret with write access to the repository, for a convenience the setting
  and the dispatch already give. Left for the founder to choose later.
- **Posting only a status `check` from the bot**, or a ruleset bypass for the
  bot. Both are the bot vouching for itself; the rule is that protection is
  not loosened.
- **Idempotency by the ledger on the data branch alone.** Enough while the
  branch is never lost, which is not a thing to rely on: a closed pull request
  and a deleted branch would forget a post. The tag does not depend on the
  branch, the pull request, the merge style or the checkout.
- **A tag in a private ref namespace** (`refs/content/…`) instead of a tag.
  Cleaner in the tag list, but unverified against GitHub; a tag is certain to
  push, and the list is short (`git tag -l 'content-attempt/*'`).
- **Auto-merge of the data pull request.** Not asked for, and merging stays the
  founder's.

## Consequences

- The founder merges one pull request, `content: data from the bots`, when they
  want the numbers on `main` (weekly is enough; nothing waits on it), with a
  merge commit, and deletes the branch after. The next run starts again from
  `main`. A squash merge works too unless a run lands between the merge and the
  next one; then `sync` stops with a message and deleting the branch recovers.
  **Closing the pull request and deleting the branch unmerged is safe for
  posts** (the tags stay and the publisher will block until the ledger is put
  back) **but loses the rows.**
- A queue file approved on `main` is posted from `content-data`, which has it
  by the merge of `main` into the branch. Merging the data pull request does
  not post anything.
- The ledger on `main` is behind until the data pull request is merged. The
  scorecard and the learned brief are built on the branch, so they are current
  there and on `main` only after the merge.
- `check` runs again (dispatched) after every push of the bots to the branch.
  On prose it is a few minutes.
- A hand-claimed post (`by: hand`, written by `npm run posted` or the pull's
  auto-claim) has no tag. Its ledger row lives on the data branch until
  merged, so losing the branch unmerged can lose it. A scripted post is
  always safe.
- TikTok is only ever a draft: for a blocked TikTok attempt, "it is there"
  means the draft is in the inbox. Post it from the app, then `npm run posted
  -- tiktok …`; clearing the tag makes the publisher draft it again.
- The switch to this design: a `content-publish` run from before ADR 0089 uses
  the old `main` ledger and no tags. Merge it when nothing approved is due, and
  never re-run an old workflow run.
- A transient platform error, which used to be retried half an hour later, now
  stops the publisher until a person has looked. That is the price of "if it
  cannot be sure, it posts nothing".
- `content/publish/run.test.ts` and `content/lib/databranch.test.ts` drive the
  real loop and the real journal against real git (a bare origin and clones of
  it), with an adapter that counts calls; they cover a rejected push, an
  unreachable branch, a previous red run, and two runs at once.
- The founder's steps are in `content/README.md`, "Where the bots' work goes".

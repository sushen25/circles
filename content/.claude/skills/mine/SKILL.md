---
name: mine
description: Lift verbatim phrases from anything people wrote (Reddit, forums, Hacker News, app reviews, replies, DMs, comments) into context/hooks.md under the right family. Given only a family or a phrase, search every readable source in docs/listening.md first and return what is worth lifting. Use when given a listening log, a pasted thread or page, a replies export, or "/mine".
---

# /mine

Input: anything people wrote, wherever they wrote it: a listening log from
the listen loop (Reddit, or any source in `docs/listening.md`), a thread or
page pasted from any site, comments on a post, DMs, or a file under
`inbox/`. The nightly pull writes `inbox/<date>-replies.md`: one
`## <slug> · <platform>` section per piece, one blockquote per reply, the
handles already stripped (`@…`, `u/…`, `[link]`). Its date is the file's,
its source label is `<platform> reply`, and once mined it moves to
`inbox/done/`.

## Nothing to mine yet: search first

Given only a family (`/mine rhythm`) or a phrase (`/mine "always the one who
organises"`), go and find where people say it.

1. Read `docs/listening.md` and `context/hooks.md`. The family's row says
   what the problem looks like, and its phrases are search terms.
2. Search every source the doc marks as working, by its rules. A source it
   marks as a skip stays skipped.
3. No tool here can read Reddit: add up to ten Reddit search links, in the
   doc's kit format, for Sushen to paste back.
4. Return **worth lifting**: for each place, the link, the date, the source,
   and in your own words what the person says and why the wording might
   work as a hook. Don't copy their sentences: from a page Claude fetched, it
   quotes at most one short line per reply. Sushen pastes the lines he wants,
   and the steps below file them.
5. This mode writes nothing to `context/hooks.md`.

## Something to mine: file phrases

1. Read `context/hooks.md`.
2. For each sentence or fragment where a real person describes the problem
   in their own words, copy it **exactly** (typos included, usernames
   stripped). Copy only from text in front of you: pasted into the chat, or
   in a file under `inbox/`. Skip anything that names a real person, a
   workplace, or a health detail.
3. File it under the one family it fits best. If it fits none, put it under
   a `### unsorted` heading at the bottom.
4. Format: `- "phrase" — <source>, YYYY-MM-DD`. The source says where it was
   said, never who: a subreddit (`r/daddit`), a forum or site (`EN World`,
   `D&D Beyond`, `HN`, `lemmy.world`, `Interpersonal Skills SE`), an app
   review (`App Store review`, never the app's name, which content can't
   use), or a channel (`threads reply`, `dm`, `tiktok comment`). The date is
   the post's; when the paste doesn't show one, the day it was pasted.
5. Replace any `(seed)` placeholder in a family the moment it has a real
   phrase.
6. Never paraphrase, never merge two people's words, never add a phrase you
   wrote.

Output: the diff you made to `context/hooks.md` and, in one line each, up to
three phrases you think are hooks as they stand.

If the input is a listening log, its "phrases people actually use" list is
the input; file those. Its "worth lifting" list is not: those need the lines
pasted first.

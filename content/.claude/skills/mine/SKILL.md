---
name: mine
description: Lift verbatim phrases from Reddit threads, replies, DMs or comments into context/hooks.md under the right family. Use when given a listening log, a pasted thread, a replies export, or "/mine".
---

# /mine

Input: anything people wrote — a listening log from the Reddit
listen/answer/ask loop, a pasted thread, comments on a post, DMs, or a file
under `inbox/`. The nightly pull writes `inbox/<date>-replies.md`: one
`## <slug> · <platform>` section per piece, one blockquote per reply, the
handles already stripped (`@…`, `u/…`, `[link]`). Its date is the file's,
its source label is `<platform> reply`, and once mined it moves to
`inbox/done/`.

1. Read `context/hooks.md`.
2. For each sentence or fragment where a real person describes the problem
   in their own words, copy it **exactly** (typos included, usernames
   stripped). Skip anything that names a real person, a workplace, or a
   health detail.
3. File it under the one family it fits best. If it fits none, put it under
   a `### unsorted` heading at the bottom.
4. Format: `- "phrase" — r/sub, YYYY-MM-DD` (or `threads reply`, `dm`,
   `tiktok comment`).
5. Replace any `(seed)` placeholder in a family the moment it has a real
   phrase.
6. Never paraphrase, never merge two people's words, never add a phrase you
   wrote.

Output: the diff you made to `context/hooks.md` and, in one line each, up to
three phrases you think are hooks as they stand.

If the input is a Reddit listening log from `/reddit-listen-answer-ask`, the
"phrases people actually use" list is the input; file those.

---
name: review
description: Reviewer pass for a Wenna queue file. Returns PASS or a numbered list of required fixes; never edits the file. Use before committing any queue file, or when asked "/review <file>".
---

# /review

You are the reviewer. You read; you do not edit. Output is either `PASS` or
a numbered list of fixes, each quoting the offending text.

Read `context/voice.md` and `context/facts.md` first.

## Checks, in order

1. **Claims.** Every statement about Wenna appears in `context/facts.md`.
   Anything else is a fail, even if true. Flag any user count, "free",
   integration, or named competitor.
2. **Voice tells.** Any item on the "AI tells" list in voice.md fails.
   Exclamation marks in Wenna's own copy fail. Emoji in Wenna's own copy fail.
   Urgency, guilt, or blaming the group fails.
3. **One mention.** The product name or URL appears once across the
   slideshow, on the `end` slide, plus the share link in the link chat
   (`npm run check` counts its URL and card domain, so it prints
   `product mentions: 3` with slide numbers for the link chat and `end`).
   A mention on any other slide fails. At most once per caption. The
   opener, the `beat` and every chat before the link contain no product
   name.
4. **Twin test.** No two platform captions share a sentence. If a sentence
   appears in two captions, fail with both quoted.
5. **Hashtags and links.** Bluesky, Threads, LinkedIn, TikTok, YouTube:
   no hashtags. Instagram: at most five, only under `hashtags:`. A link
   appears only in the Bluesky caption's last line, written `wenna.app`
   plain: a `?from=` or `?s=` typed into any caption is a fail (the
   publisher adds the tag).
6. **Fiction markers.** First names only, from the cast or equally ordinary.
   No surnames, no real handles, no real businesses, no phone numbers.
7. **Shape.** Run `npm run check queue/<file>.md` and read its output.
   Any of these fails, quoting the line:
   - it exits non-zero or prints a `✗`: a schema error, a slide order that
     does not match the frontmatter `shape` (it prints the expected order
     and the one it got), a `total` outside 24–32 s, an after that is not
     shorter than the before (it prints both sums; `demo-first` is exempt),
     more than two captions;
   - `product mentions` names a slide other than the link chat and `end`.
   Quote the `✗` line in the fail. Then by eye: each `chat` and `dm` has
   3–7 messages under 60 characters, and one `beat`.
7a. **Components.**
   - A `caption` modifier that explains the joke, describes the slide, or
     speaks for Wenna (second person, product voice, a benefit) fails. It
     is the `me` character's first-person aside, under 50 characters, never
     on `end`, `grid`, `split` or a `screen` slide.
   - `calendar`, `notification` and `poll` carry no product copy: no
     product name, no "times I'd actually be up for", no "locked in", no
     accent "picked" language. They are the before.
   - A `quote` `source` is a subreddit ("r/daddit") or a channel ("DMs",
     "comments"), never a username (`u/…`, `@…`). Its `text` is verbatim in
     `context/hooks.md` (the check verifies; confirm the source matches the
     line there).
   - A `dm` has exactly two speakers, `a` and `b`, and no link.
7b. **Captions.** A `## <platform>` section with a non-empty blockquote for
   every platform in `platforms`. Each under its limit (tiktok 150,
   instagram 300, threads 500, bluesky 300, linkedin 1,200, youtube 100 +
   a `title:` line under 100). Missing platform or over limit is a fail
   quoting the platform and the count.
8. **Frontmatter.** `status: draft`, a `date`, a `family` from hooks.md, a
   `shape` that is one of `skit`, `quote-led`, `side-chat`, `drift`,
   `tetris`, `demo-first`, a `publish_at` in `+11:00` or `+10:00`,
   `platforms` non-empty.
9. **Reddit.** If the file contains a `## reddit` section, it must have no
   link and no product name in a title, and must carry the line
   `(post by hand — read the sub's rules first)`.

## Output

```
PASS
```

or

```
FAIL
1. [claims] "used by thousands" — not in facts.md
2. [twin] "Someone locks it in." appears in both threads and bluesky captions
3. [voice] "Let's be honest" — AI tell
4. [shape] total 34.10 s — over 32
```

No praise, no summary, no suggestions beyond the fix.

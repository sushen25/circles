---
name: skit
description: Write one Wenna group-chat skit as a queue file — frontmatter, slideshow JSON, and a platform-native caption per channel. Use when asked for "a skit", "today's slideshow", or "/skit <family>".
---

# /skit

Write one queue file: `queue/YYYY-MM-DD-<slug>.md`. Read `context/voice.md`,
`context/facts.md`, `context/hooks.md` and `experiments.md` first, every time.

After those, read `context/learned.md`, the brief the nightly run writes
from the numbers. Prefer what "Do more of" names for this family and shape,
avoid what "Stop" names, and treat "Too early" as no information at all. It
never overrides a rule in voice.md, facts.md or hooks.md, and it is never a
source for a claim: a number from it does not go into a slide or a caption.

## Inputs

- A hook family id from `context/hooks.md` (default: the first live family in
  `experiments.md` that has fewer pieces this fortnight).
- Optionally a hook line from `/hooks`. Otherwise write one in a labelled
  archetype.
- Optionally a shape id from the table below (`/daily` passes one). Otherwise
  pick one the family suits that is not the shape of the family's previous
  piece in `queue/` or `published/`.

## The rules

These hold whatever the shape. The same JSON renders as a slideshow
(`npm run render`) and as an animated video (`npm run video`).

- **Length: 24 to 32 seconds as video**, measured by `npm run check`, never
  estimated by hand.
- **An opener first, `end` last.** Openers are `cover`, `quote` and `count`.
- **The product appears once, on the `end` slide**, in the words of
  facts.md. The one exception is the share link itself in the link chat
  (below). `npm run check` counts the link message's URL and its card's
  domain too, so a correct piece prints `product mentions: 3` (two on the
  link chat, one on `end`). A mention on any other slide is a fail.
- **Links in captions are `wenna.app`, plain.** The publisher adds
  `?from=<platform>-<slug>` on the way out and `npm run check` fails a draft
  that carries its own `?from=`. Plan links inside a fictional chat
  (`wenna.app/j/xxxx`) are left as they are.
- **The "after" is shorter than the "before".** The after is the link chat,
  `screen` slides, `grid` and `compare`; the before is everything up to the
  `beat`. Add the seconds from the check output. If the after is longer, the
  piece stops being funny and becomes an ad. (`demo-first` is the one
  exception: it is the control arm that tests exactly this.)
- **The chat is the joke.** No narrator. The only voice outside the chats is
  the `caption` modifier (below): the viewer's character, never Wenna, never
  explaining the joke.
- 3 to 7 messages per `chat` or `dm`, each under 60 characters. Real
  texting register: lowercase is fine, a stray emoji from a character is
  fine, Wenna's own copy never uses one.
- Names from the cast in voice.md, first names only. Nobody is the villain.
- Set `"me"` on the skit to the character the viewer should identify with
  (their messages render right-aligned in accent). Usually the organiser.
- `"motion"` on the skit is optional: `"lively"` (the default) or `"calm"` (smaller pops with no
  overshoot, a gentler beat, a slower lock-in whose marks land on rising notes). Leave it out
  unless the founder has picked calm. Neither changes a piece's length.
- Time stamps are allowed and are the best joke there is ("Tue 9:14 pm",
  "Sun 7:42 pm, a month on").
- `pace`: `"fast"` for the keen-at-first chat, `"slow"` on the slide where
  the joke lands, so the video lingers on it.
- No exclamation marks in Wenna's lines. Characters may use them.
- The link chat: the organiser pastes the link with the real share copy,
  "mark the times you'd actually be up for: wenna.app/j/xxxx", and the
  message carries a `link` object so the chat shows a preview card. Replies
  are short ("done").
- Screen slides use the product's own copy from facts.md and the design
  files: "Times I'd actually be up for", "Send my times", "Locked in",
  "You're going". Do not invent features.

## Shapes

Pick one. The order is fixed; slots in `[brackets]` are optional. "chat" is a
group-chat slot (a `chat`, or a `poll` in its place); "chat+link" is the
link chat. A `skip` may go before any chat slot for the biggest time jump
(0.9 s). Put `shape: <id>` in the frontmatter.

| id | Slide order | Target | Suits |
|---|---|---|---|
| `skit` | cover · chat ×2–3 · beat · chat+link · screen availability · screen locked · end | 28–32 s | all |
| `quote-led` | quote · chat ×2 · beat · chat+link · screen availability · screen locked · end | 26–30 s | drift, catchup, pm |
| `side-chat` | quote or cover · split(chat, dm) · [dm] · beat · chat+link · screen locked · end | 26–31 s | skit, catchup |
| `drift` | cover · notification · skip · notification · beat · chat+link · screen availability · end | 26–30 s | drift, rhythm |
| `tetris` | count · calendar · chat · beat · screen availability · screen locked · end | 28–32 s | roster, rhythm |
| `demo-first` | cover · chat+link · screen availability · screen locked · compare · end | 24–26 s | demo; the control arm for the first experiment row |

**skit.** The group chat failing in two or three time-stamped scenes, a
beat, then the link. It works when each chat is a different stage of the
same failure (keen, vague, silence) and the time stamps carry the jokes. It
goes wrong on length: three full chats plus both screens runs past 40 s, so
three chats means 3–4 messages each, or drop a screen. It is the baseline
every other shape is compared with.

**quote-led.** A real person's line opens, and the chats act it out. It
works when the quote is specific enough that the chats feel like proof
("take a break from initiating", then a month of the organiser not
initiating). It goes wrong when the chats restate the quote instead of
showing it, or when the quote needs context to land. The quote must be
verbatim in hooks.md and is the hook in the frontmatter.

**side-chat.** The group agrees in public; the `dm` beside it says what
nobody says to the group. It works because the gap between the two panes is
the joke, so the left chat should be short and keen and the dm should undo
it. The `beat` names what happens next ("Sorry guys…"). It goes wrong when
the dm is mean about someone (nobody is the villain) or when a second `dm`
pushes it past 32 s; the split alone is about 8.5 s. No availability screen:
there is not the time.

**drift.** Time passing with nobody replying, told with `notification`
stacks and a `skip` between them. It works when the timestamps on the
banners are the joke and the same person keeps asking. It goes wrong when
banners carry dialogue (that is a chat) or when the link chat is long:
keep it to 2–3 messages or the after outgrows the before.

**tetris.** A number, then a `calendar` crossing out days one person at a
time, then the one chat where it shows. It works for shift workers and
groups with a rhythm, where the problem is literally the calendar. It goes
wrong when the calendar resembles the product's availability screen (it is
the before: crosses, never fills) or when a 14-day calendar plus a long chat
breaks the budget; use `days: 7` when tight.

**demo-first.** The product working, with almost no before: one cover line,
the link landing, the screens, a compare. It exists to test the claim that
story-first beats demo-first, so it is exempt from the after-shorter rule
and from nothing else. It goes wrong when it starts to sound like an ad:
the end slide is still the only product mention, and the compare is nouns
and numbers, not benefits. A 5-message link chat gets it to 24 s.

## Components

Seconds are measured from gallery fixtures; your props change them, the
check output is the truth.

- `cover` {line1, line2?} 1.5–3.0 s (reading time; at rest from frame 0 as slide 1). Use for a written hook (count, time, role,
  contrast, plain). Not for a verbatim phrase: that is `quote`.
- `quote` {text, source} 2.5–3.5 s (up to 4.0 s as slide 1: at rest from frame 0, held to be read). Use when the hook is a real person's
  line: `text` verbatim from hooks.md (the check fails anything else),
  `source` the subreddit or channel ("r/daddit", "DMs", "comments"), never
  `u/` or `@`. Not for a paraphrase. Inner quotes and ellipses render as
  written; only a matching pair of outer quote marks is removed.
- `count` {lines[{n, of}]} 1.6–2.8 s (1.8–3.0 s as slide 1: at rest from frame 0). Use when a number is the hook: one to
  three lines, every number paired with its meaning ("0", "plans"). Not for
  a number that is not in the story or in facts.md.
- `chat` {title, when?, pace?, messages[{from, text, link?}]} about 6 s. The
  workhorse. A digitless `when` adds a 0.9 s skip card; prefer an explicit
  `skip`. Not for a one-on-one: that is `dm`.
- `skip` {line, sub?} 0.9 s. Use for the biggest time jump ("Five weeks
  later", sub: the chat title). Not more than one per piece.
- `beat` {line} 2.3–3.2 s (it holds for its reading time, caption included; the caption rises after the last word). The emotional summary after the before, three
  words at most: "Every. Single. Time." / "Sorry guys…". Never a product
  line.
- `dm` {a, b, when?, pace?, messages} about 8.4 s alone for the slow fixture. Use for what two people
  say to each other that they do not say to the group: 3–7 messages, only
  `a` and `b` speak, no links. Not for exposition or for being unkind about
  a third friend.
- `split` {left: chat, right: dm, order: "sequence"} about 8.5 s. The group
  chat, then the dm beside it. Children are `chat` and `dm` only; no time
  skip (digitless `when`) and no `caption` inside or on it. Keep the left
  chat to 3–4 messages so it fits the pane.
- `notification` {when?, items[{group, from, text, time}]} ~4 s for 3
  items. Use for drift without a single reply: 2–6 banners, the times are
  the joke. Not for a conversation, and never product copy.
- `poll` {title, when?, asked, question, options[{label, votes[]}], after?}
  about 5.7 s. Use in a chat slot for the poll where every option gets a vote
  (names, not counts). Question under 40 characters, labels under 12, at
  most 8 votes. Never product copy.
- `calendar` {title?, start, month?, days 7|14, firstDow?, people[{name,
  busy[]}], note?} ~6 s for 7 days, ~7.6 s for 14. Use for the "before" when
  the problem is diaries that do not line up. Never the product, never
  product copy.
- `screen` `availability` ~4.3 s, `screen` `locked` ~2.6 s. The after: the
  guest screen and the locked-in card, copy from facts.md only. See
  `render/components/screen-*.js` for props.
- `compare` {before[], after[]} ~3.5 s. Three short lines each, nouns and
  numbers, no verbs: "3 weeks" / "14 messages" / "0 plans". After only.
- `grid` {caption, days, picked, note?} ~3 s. The answer screen with no
  product name. Its `caption` is its heading, not the modifier.
- `end` {line, url} ~4.7 s. The one product mention. Use the line from
  voice.md's worked example unless facts.md supports a better one.

**The `caption` modifier.** Any slide except `end`, `grid` and `split` may
carry `"caption": "fourth thursday in a row"`: a first-person line in the
`me` character's voice, under 50 characters, no product name, no
exclamation mark, at most two per piece. It adds a thought the slide does
not show ("for the record, it was me"); it never explains the joke and
never speaks for Wenna. Keep it off `screen` slides: it crowds the phone.

## Check before review

Run `npm run check queue/<file>.md` and fix every `✗` it prints before
`/review`: schema errors, a slide order that does not match the `shape`
in the frontmatter, a total outside 24–32 s, an after that is not shorter
than the before (it prints both sums), more than two captions. Product
mentions must sit only on the link chat and `end`. Note the shape and the
check's total in the PR body.

## Output format

````markdown
---
slug: take-a-break
date: 2026-10-14
family: pm
hook: "\"take a break from initiating\""
archetype: quote
shape: quote-led
status: draft
platforms: [tiktok, instagram, threads, bluesky, linkedin, youtube]
publish_at: 2026-10-14T18:00:00+11:00
publish_window_minutes: 90
media: slideshow
---

```json
{
  "hook": "\"take a break from initiating\"",
  "me": "Priya",
  "slides": [
    { "type": "quote", "text": "take a break from initiating and trying to reschedule", "source": "r/Mommit" },
    { "type": "chat", "title": "Thursday crew", "when": "Sun 7:42 pm",
      "messages": [
        { "from": "Priya", "text": "dinner this week?" },
        { "from": "Tom", "text": "keen" },
        { "from": "Nina", "text": "thu or fri" },
        { "from": "Marcus", "text": "will check" }
      ] },
    { "type": "chat", "title": "Thursday crew", "when": "Sun 7:42 pm, a month on", "pace": "slow",
      "caption": "fine. i'll wait for someone else",
      "messages": [
        { "from": "Priya", "text": "dinner this week?" },
        { "from": "Priya", "text": "anyone?" },
        { "from": "Priya", "text": "ok" }
      ] },
    { "type": "beat", "line": "Still me." },
    { "type": "chat", "title": "Thursday crew", "when": "Mon 8:05 pm",
      "messages": [
        { "from": "Priya", "text": "mark the times you'd actually be up for: wenna.app/j/7f3k",
          "link": { "url": "wenna.app/j/7f3k", "title": "Thursday crew is finding a time to catch up", "sub": "Pick the times you'd actually be up for. No app needed.", "domain": "wenna.app" } },
        { "from": "Tom", "text": "done" },
        { "from": "Nina", "text": "done" }
      ] },
    { "type": "screen", "screen": "availability", "lead": "The link opens this. No account.",
      "plan": "Thursday crew · next 14 days", "start": 12,
      "picks": [
        { "day": 15, "when": "Eve", "label": "Thu 15 Oct", "time": "6:30–10 pm" },
        { "day": 22, "when": "Eve", "label": "Thu 22 Oct", "time": "6:30–10 pm" }
      ],
      "sentLine": "Done. Your times are in.", "sentSub": "Your friends only see the combined result." },
    { "type": "screen", "screen": "locked", "lead": "Priya locks it in. Everyone gets this.",
      "circle": "Thursday crew", "date": "Thursday 22 October", "time": "7–9:30 pm",
      "place": "Nina's place", "area": "Fitzroy",
      "people": ["Priya", "Tom", "Nina", "Marcus"], "going": "4 of 4 going" },
    { "type": "end", "line": "One link in the chat. Everyone marks the times they'd actually be up for. Someone locks it in.", "url": "wenna.app" }
  ]
}
```

## tiktok
Under 150 characters. No hashtags, no link. Lowercase texting register is fine. The publisher sends the piece to the TikTok inbox as a draft; the founder pastes this caption, picks a sound and posts.

> priya tried not initiating for a month. you can guess

## instagram
1–3 short lines, under 300 characters. Up to five hashtags under `hashtags:`; the publisher puts them on their own line at the end of the caption, never inside the sentence.

> Every group has one organiser. Priya took a month off and the chat took one too.

hashtags: #friends #melbourne #groupchat

## threads
One or two sentences, under 500 characters, conversational, may ask a real question. No hashtags, no link.

> If the organiser in your group stopped organising, how long would it be before anyone noticed? Asking for a friend who is definitely not me.

## bluesky
Under 300 characters, plain, founder voice allowed, the link as the last line.

> A line from a Reddit thread about organising friends: "take a break from initiating and trying to reschedule". In our dinner crew, nothing would happen. Making a small thing so one person doesn't have to chase everyone.
> wenna.app

## linkedin
Under 1,200 characters, 3–6 short paragraphs, build-in-public register: one specific thing you learned, the number if there is one, a closing question. No hashtags. Link in the first comment, not the post.

> Every friend group has one person who does the scheduling.
>
> The advice they get online is to take a break from initiating. I tried it with our dinner crew. A month later the chat was exactly where I left it.
>
> So I'm building a small thing for it. One link in the chat, everyone marks the times they'd actually be up for, someone locks it in. No app, no account.
>
> Who's the organiser in your group, and have they ever been given the month off?

## youtube
A `title:` line under 100 characters (this is what Shorts shows) and a one-line description under 100 characters. No hashtags in the title. The publisher uploads the MP4 as a Short with this title and line.

title: The organiser took a month off

> Sunday, 7:42 pm. Same question, a month apart, same silence.
````

The JSON above passes `npm run check` at 28.4 s: before (quote, two
chats, beat) 12.4 s, after (link chat, two screens) 11.4 s, product
mentions 3, captions 1.

## Captions, the rules

Every piece carries one `## <platform>` section for **every** platform in
`platforms`, and `platforms` defaults to all six: `tiktok`, `instagram`,
`threads`, `bluesky`, `linkedin`, `youtube`. Drop one only when the piece
genuinely does not suit it, and say why in the PR body.

| Platform | Limit | Register | Hashtags | Link | Posted by |
|---|---|---|---|---|---|
| tiktok | 150 | texting, lowercase ok | none | none | script drafts, founder posts |
| instagram | 300 | 1–3 lines | ≤5, under `hashtags:` | none | script |
| threads | 500 | conversational, a real question | none | none | script |
| bluesky | 300 | plain, founder voice | none | last line | script |
| linkedin | 1,200 | build-in-public, 3–6 paragraphs, closing question | none | first comment | script |
| youtube | 100 title + 100 line | `title:` line plus one sentence | none | none | script |

Twin test: no sentence appears in two captions. Each platform gets its own
angle on the same hook, not a trim of the same sentence: TikTok is the
punchline, Instagram the caption under a photo, Threads the question,
Bluesky the founder aside, LinkedIn the lesson, YouTube the title.

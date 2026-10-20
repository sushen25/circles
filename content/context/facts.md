# Allowed facts

The only claims any draft may make. Anything not on this list gets `[VERIFY]`
and fails review. Add a line here (with where it comes from) before using it.

## Product

- Wenna is a web app at wenna.app. The product is called Wenna; "Circles" is
  the internal codename and never appears in content.
- One link is pasted into a group chat. Friends open it and mark the times
  they would actually be up for.
- Guests need no account, no app, no calendar access.
- The organiser confirms a time; Wenna does not decide for the group.
- Nobody is shown as having said no. Members see a combined result, not each
  other's answers.
- Wenna asks for willingness ("times I'd actually be up for"), not free/busy.
- Built in Melbourne by one person.
- Tagline: "Plans with friends".
- A plan has a number: "we go if 4 of 6 can make it." The organiser sets it
  and the link shows "x of y can make it".
- Replies close at a set time. The organiser gets one reminder, can extend
  by a day once, or hand the organising to someone else. The plan does not
  wait for the one who has not answered.
- Quiet ask: someone can ask whether people are up for something without it
  being a plan yet. It only becomes a plan once enough people say yes.
  Nobody is told who did not. "Nobody gets turned down."
- Usual times remembered: when a group has a rhythm, Wenna asks the
  organiser "about time?" once per cycle, and can suggest whose turn it is to
  pick. The nudge goes to the organiser, never to the group.
- One open plan per group at a time.
- Presets: Tonight, This weekend, Next two weeks.
- The locked-in time can be added to everyone's calendar (an .ics file).
  That is the only calendar involvement; Wenna never reads anyone's calendar.

## Status (keep current)

- As of 2026-10-16: live on the web at wenna.app; the founder's own friend
  groups have been using it since early October; no one outside that circle
  yet. Content may say "building", "early", "work in progress", "my friends
  have been using it". Content may not say "join thousands", "used by", or
  cite any user number.
- No pricing has been set. Content may not say "free" as a promise; it may
  say "no account needed".

## Things never claimed

- That Wenna cures loneliness, fixes friendships, or makes anyone a better
  friend.
- Any comparison naming Howbout, Partiful, Doodle or When2meet by name.
- Any statistic about how often plans fail, unless added here with a source.
- Any integration (WhatsApp, iMessage, Google Calendar) beyond "paste the
  link in the chat".

## Sourced numbers (none yet)

| Claim | Source | Added |
|---|---|---|

## Link tags (not claims; for the publisher and the bios)

Every published link is `wenna.app/?from=<platform>-<slug>`, made by
`lib/links.ts`; never hand-write one in a draft. Standing hand tags, kept
here so there is one scheme:

- TikTok profile link: `wenna.app/?from=tt-bio`
- Instagram profile link: `wenna.app/?from=ig-bio`
- Reddit profile / comment links: `wenna.app/?from=rd-profile`, or
  `rd-<thread-slug>` for a reply inside a thread
- Comparison pages, when they exist: `cmp-doodle`, `cmp-when2meet`,
  `cmp-whatsapp-polls`

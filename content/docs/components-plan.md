# Components plan

## Status

Phases 0–3 are implemented on branch `claude/components` as of 2026-10-17:
the registry and all sixteen components, `npm run check`, the gallery, the
shapes in `/skit`, the new `/review` checks, the shape rotation in
`/daily`, and the `Shape` column in `experiments.md`. The proof piece for
the side-chat shape is `queue/2026-10-17-sorry-guys.md` (27.3 s).

### What changed in practice

- `split` takes `chat` and `dm` children only, `order: "sequence"` only
  (no interleave), no digitless `when` inside a pane, and no `caption` on
  the split or its panes. It stacks the panes offset rather than side by
  side, so bubble text stays readable. ~10–11 s with a 3–4 message chat
  and a 4-message dm.
- The `caption` modifier is never on `end` (it would read as a
  testimonial) or `grid` (whose own `caption` prop is its heading), nor on
  `split`. The skill also keeps it off `screen` slides.
- `calendar` costs ~7.6 s for 14 days and ~6 s for 7; `days: 7` is the
  default when the budget is tight. Most other costs are as planned: chat
  4–8 s, dm 6–8 s, notification ~4 s for three, poll ~6 s, quote 2.5–3.5 s.
- `npm run check` prints schema, whether the slide order matches the
  frontmatter `shape`, per-slide and total seconds with the 24–32 s rule,
  the before/after sums with the after-shorter rule, product mentions and
  caption count. Every `✗` exits 1.
- Product mentions as counted by the check include the share link's URL
  and card domain in the link chat, so a correct piece prints 3 (two on
  the link chat, one on `end`). The rule is unchanged: any other slide
  naming the product fails.
- `side-chat` opens with `quote` or `cover`, not a bare `chat` (the
  opener-first rule), and the standalone `dm` after the split is optional:
  with it the shape runs past 32 s. It has no availability screen.
- `demo-first` is exempt from "the after shorter than the before"; it is
  the control arm that tests that rule. Its target is 24–26 s.
- `quote` removes only a matching pair of outer quote marks from `text`;
  inner quotes and ellipses render as written.
- The two pieces written before the shapes existed carry `shape: skit`;
  `suddenly-a-month` measures 41.7 s and fails the 24–32 s rule as it is.
- `/daily` gained a step: `npm run check` runs before `/review`.

Agreed 2026-10-16. The goal: the script writer composes a piece from a
vocabulary of components and named shapes, instead of filling one fixed
seven-step arc. The hard rules in `CLAUDE.md`, `context/voice.md` and
`context/facts.md` do not change.

Decisions taken:

- Registry refactor first, then components, then the skills.
- First batch: `quote`, `count`, `skip`, the `caption` modifier, `dm` with
  `split`, then `notification`, `poll`, `calendar`.
- The skit skill offers named shapes (a menu with a slide order each), not
  one arc and not "rules only".
- A first-person `caption` over a scene is allowed: the viewer's character
  speaking, never Wenna's voice.

## Why the current setup limits variety

- The arc is fixed in three places: the skit skill prescribes it, the review
  skill fails deviations (check 7), and the renderer knows seven types.
- Every type is implemented twice, in `render/slides.ts` (stills) and
  `render/video.html` (scenes). They have drifted already: the video has an
  end-slide `descriptor` and a "Sent" state the stills lack.
- `build()` in `video.html` is one linear function with a shared `t`, so
  components cannot nest or sit side by side.

## Phase 0: registry

One implementation per component, both outputs from it.

```
render/
  components/
    _kit.js          esc, el, MARK, anim primitives, Timeline
    index.js         registry: { [type]: Component }
    cover.js  beat.js  chat.js  screen-availability.js  screen-locked.js
    compare.js  grid.js  end.js          (migrated, output unchanged)
    quote.js  count.js  skip.js  dm.js  split.js        (phase 1)
    notification.js  poll.js  calendar.js               (phase 2)
  styles.css         one stylesheet, both modes; `body.still` hides video-only bits
  template.html      loads styles.css + components as an ES module
  video.html         same
  render.ts  video.ts  gallery.ts
lib/
  check.ts           schema + duration + rule checks for one queue file
```

Components are plain ESM `.js` with JSDoc types so the same file runs in
Node (schema, fixture, estimate) and in Chromium (scene). No bundler, no
build step, which keeps the repo's zero-build rule.

The contract:

```js
export default {
  type: 'dm',
  /** returns [] or a list of human-readable errors */
  schema(props) {},
  /** props the gallery renders */
  fixture: { ... },
  /** builds the scene into `root`, registering animations and cues on `tl`.
   *  returns { poster: seconds } — the frame the still is taken from */
  scene(props, ctx, tl) {},
  /** optional: HTML for the still when the poster frame is not the right
   *  picture (availability ends on "Sent", the still wants the calendar) */
  still(props, ctx) {},
};
```

- **Still = poster frame.** `render.ts` builds the scene exactly as the video
  does, seeks to `poster`, adds the carousel chrome (counter, "swipe") and
  screenshots. Drift between stills and video becomes impossible by
  construction. `still()` is an override, not the norm.
- **Timeline** replaces the shared `t`: `tl.now`, `tl.add(s)`, `tl.cue(kind)`,
  `tl.enter(node)`, `tl.exit(node)`, `tl.child()` for modifiers. Easing,
  `pop`, `rise`, `reserve`, `press` and the SFX kinds move into `_kit.js`
  unchanged.
- **`ctx`** carries `me`, slide index and count, and the cast.
- **`npm run gallery`** renders every component's fixture, still and a
  three-frame strip of its scene, into `out/gallery/contact.png`. Run it in
  every renderer PR.
- **`npm run check queue/<file>.md`** prints schema errors, estimated total
  seconds and per-slide seconds, product-mention count, caption counts and
  the shape it matches. It launches Chromium for the estimate (one second,
  exact). `/review` runs it instead of hand-checking shape.

Done when: both existing queue files re-render with pixel-identical PNGs
and an MP4 of the same length as today, and the gallery shows all eight
migrated components.

## Phase 1: openers, punctuation, the side chat

### `quote`

A verbatim phrase with its source. The opener for quote-archetype hooks.

```json
{ "type": "quote", "text": "suddenly it's been a month since we last chatted", "source": "r/daddit" }
```

Big Newsreader text in quotes, source as a small label. Video: words rise in
pairs like `cover`, source fades last. Rule, checked by `check.ts`: `text`
must appear verbatim in `context/hooks.md`. Source is the subreddit or
channel only, never a username.

### `count`

A number paired with its meaning. One or two lines.

```json
{ "type": "count", "lines": [{ "n": "14", "of": "messages" }, { "n": "0", "of": "plans" }] }
```

Video: each number rolls up from 0 with ticks, the second line lands with a
thud. Still: final state.

### `skip`

The explicit time-skip card. Today a `chat` whose `when` has no digits makes
this card implicitly; keep that behaviour for old files, prefer `skip` in
new ones.

```json
{ "type": "skip", "line": "Five weeks later", "sub": "Uni lot" }
```

### `caption` (modifier on any slide)

```json
{ "type": "chat", "caption": "fourth friday in a row", ... }
```

A short first-person line in the viewer's character, rendered as a pill in
the lower left above the safe area, Figtree, accent-soft. Rules: under 50
characters, first person, at most two per piece, no product name, no
exclamation marks. `check.ts` counts them; `/review` reads them.

### `dm`

A one-on-one chat beside the group chat. The strongest new comedy device:
what two people say to each other that they do not say to the group.

```json
{ "type": "dm", "a": "Nina", "b": "Tom", "when": "Fri 4:51 pm",
  "messages": [
    { "from": "Nina", "text": "are you going tonight" },
    { "from": "Tom", "text": "are you" },
    { "from": "Nina", "text": "i will if you will" }
  ] }
```

Reuses the chat internals (typing, pops, `me` alignment) with different
chrome: two names in the head, a narrower column, surface tinted
`--accent-soft` so it reads as a side room. Same message limits as `chat`.

### `split`

Two components side by side. Built for group chat plus `dm`, works for any
two that fit a half-width column.

```json
{ "type": "split", "left": { "type": "chat", ... }, "right": { "type": "dm", ... } }
```

Each child runs on `tl.child()`; `split` can play them in sequence (left
then right, the default) or interleaved by message. The still shows both at
their poster frames.

## Phase 2: the "before" without dialogue

### `notification`

Banners piling up across time. Drift shown without a single reply.

```json
{ "type": "notification", "when": "Three weeks",
  "items": [
    { "group": "Thursday crew", "from": "Tom", "text": "anyone?", "time": "Mon 9:12 pm" },
    { "group": "Thursday crew", "from": "Tom", "text": "pub fri?", "time": "Thu 6:40 pm" }
  ] }
```

Stylised cards in the Wenna palette, not a lookalike of any phone's lock
screen (the "no real phone UI chrome" rule). Video: each banner pops in and
pushes the earlier ones down, the time label on each is the joke.

### `poll`

The group-chat poll where every option gets one vote.

```json
{ "type": "poll", "asked": "Tom", "title": "when's everyone free", "when": "Sun 7:42 pm",
  "options": [
    { "label": "thu", "votes": ["Tom", "Jess"] },
    { "label": "fri", "votes": ["Dev"] },
    { "label": "sat", "votes": ["Sam"] }
  ] }
```

A poll card inside a chat bubble, bars that fill as votes land, names under
each bar (voice.md: names, not counts, where a count would sting). Our own
styling, not a messenger's.

### `calendar`

A fortnight where each person's conflicts cross out days until nothing is
left.

```json
{ "type": "calendar", "start": 12, "days": 14,
  "people": [
    { "name": "Jess", "busy": [12, 13, 17, 18] },
    { "name": "Dev", "busy": [14, 15, 19] }
  ] }
```

Video: one person at a time, their name as a label, their days cross out
with ticks; the last clear day gets a beat. This is the "before", so it must
not resemble the product's availability screen: crosses and `--ink-3`, never
the accent fill the product uses for "times I'd be up for".

## Phase 3: the writing side

### `/skit` gets shapes

The rules stay: one product mention on the end slide, the after shorter than
the before, 24 to 32 seconds as video, an opener first and `end` last, chat
messages under 60 characters. The structure becomes a menu. Each shape lists
its slide order, target length and the families it suits.

| Shape | Order | Suits |
|---|---|---|
| skit | cover · chat ×2–3 · beat · chat+link · availability · locked · end | all (current arc) |
| quote-led | quote · chat ×2 · beat · chat+link · availability · locked · end | drift, catchup, pm |
| side-chat | chat · split(chat, dm) · dm · beat · chat+link · locked · end | skit, catchup |
| drift | cover · notification · skip · notification · beat · chat+link · availability · end | drift, rhythm |
| tetris | count · calendar · chat · beat · availability · locked · end | roster, rhythm |
| demo-first | cover · chat+link · availability · locked · compare · end | demo; the control arm for the first experiment row |

Each component gets a "use it when / not when" line in the skill. The skill
tells the writer to run `npm run check` before `/review`.

### `/review`

Check 7 ("Shape") becomes: `npm run check` passes, the order matches one
named shape, one product mention. New checks: a `quote` text is verbatim in
hooks.md (the script verifies, the reviewer confirms the source), captions
under the limits above, `calendar` and `notification` carry no product copy.

### `experiments.md`

Add a `Shape` column after `Family`, so a fortnight can compare two shapes
on one family. The first row's hypothesis already needs it: skit versus
demo-first.

### Migrations

- The two queue files keep rendering; `chat` with a digitless `when` still
  produces the skip card.
- `/daily` is unchanged except that it passes the shape it chose into the
  PR body.

## Order and size

| Phase | Work | Proof |
|---|---|---|
| 0 | kit, timeline, registry, migrate 8 types, styles.css, gallery, check | pixel-identical re-render of both queue files; gallery sheet |
| 1 | quote, count, skip, caption, dm, split | gallery; one new piece in the side-chat shape |
| 2 | notification, poll, calendar | gallery; one piece in the drift shape, one in tetris |
| 3 | skit shapes, review changes, experiments column | `/daily` runs end to end on a non-skit shape |

Later, not now: `layer` (one component over another), a `quietask` screen
(the quiet-ask flow in facts.md has no component), `tally` ("3 of 4 can make
Thursday"), per-component sound design, a music bed.

## Risks to watch

- Richer components make longer videos. `check` prints the budget so the
  writer sees it before rendering.
- `notification` and `poll` sit closest to the "no real phone UI chrome"
  rule. Gallery review of each before it is used in a piece.
- `calendar` sits closest to the product's availability screen. Crosses,
  never accent fills.
- The caption modifier is the first narrator-like device. Two per piece,
  first person, and the reviewer fails anything that explains the joke.

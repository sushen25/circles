# Design manifesto

_Version 1 &mdash; 31 August 2026_

_Companion to the [MVP product spec](./initial-mvp-product-spec.md), the [market research](./research/meetup-market-research.md) and the [consumer SaaS research](./research/consumer-saas-success-research.md). Those documents decide **what** we build. This one decides **how it looks, reads and feels**, and holds each choice to a reason._

_Reference implementation: the Slice 1 canvas ("Rounds Meetup Flow"). Where this document and the canvas disagree, this document wins and the canvas gets updated._

---

## 1. The problem the design has to solve

A group of adults who like each other, who want to see each other, and who don't.

Not because they can't find a time. Because someone has to ask, someone has to chase, someone has to decide, and every one of those jobs costs social capital that nobody wants to spend. The scheduling maths is the easy part. The research is unambiguous on this: *"The hard part is often the final non-responder or nobody wanting to make the decision &mdash; not calculating overlap."*

So the product is not a calendar, a poll, or an event tool. It is a **way of moving a group from wanting to doing, at the lowest possible social cost**.

Design's job is to make sure the product never becomes part of the problem it exists to solve.

### The design north star

> **A person who has never seen this product before can answer honestly in under sixty seconds, and feel good about having done so.**

Everything below serves that sentence. If a design decision doesn't, it is decoration.

---

## 2. The two ways this design can fail

Every review should check both.

**Failure one: we become new friction.**
Another app. Another account. Another grid to fill in on a phone. Another notification. The competitor that beats us is not Howbout &mdash; it is the group chat everyone is already in, which requires nothing. If our flow is heavier than "someone types _when's everyone free?_ into WhatsApp", we lose, no matter how good the algorithm is.

**Failure two: we make someone feel worse about a relationship they care about.**
"You haven't met in three months." "Four people said no." "Nobody's interested." A scheduling tool that produces guilt or visible rejection is worse than no tool. We are operating on people's friendships. That earns caution, not cleverness.

These two failures pull in opposite directions &mdash; the fix for friction is usually *less*, the fix for hurt is usually *more care* &mdash; and holding both at once is the actual design work.

---

## 3. Principles

Each principle states a rule, the evidence behind it, what it forbids, and how to test whether we followed it.

### 3.1 The best session is the shortest one

Time in this product is a cost we impose on someone, not a metric we harvest. Our north star is meetups that happened &mdash; not opens, not sessions, not "engagement". A member who answers in 25 seconds and closes the tab is a **success**, not a churn risk.

**Why.** The spec's decision gates target a median response under two minutes with a stretch goal of sixty seconds. The consumer SaaS research is blunt that retention must come from a real recurring outcome, not from mechanics that manufacture returns.

**Forbids.** Feeds. Streaks. Badges. Unread counts that aren't decisions. "Discover". Anything that rewards opening the app without a meetup on the other side. Interstitials, tours, and celebratory screens that stand between a person and the thing they came to do.

**Test.** Every screen carries a stated target time-to-complete. Anything on it that doesn't serve that number is cut.

### 3.2 No toll at the door

Value comes before account, permission, or install &mdash; every time, for every role. An invited member reaches a submitted answer without creating anything, granting anything, or downloading anything.

**Why.** This is the single largest activation risk in the product. Howbout's reviews repeatedly complain that the app is locked until a friend accepts an invitation; Partiful's are repeatedly grateful that guests don't need the app. Hypothesis H2 stands or falls here.

**Forbids.** Sign-in walls before value. Calendar permission during onboarding. Invite-gating ("invite two friends to continue"). "Open in app" prompts on the guest path. Email as a precondition rather than an offer.

**Test.** Trace the guest path from link tap to submitted answer. Count the account prompts and permission dialogs. The number is zero. Any prompt that appears after the answer must be dismissible in one tap.

### 3.3 Ask for willingness, never infer availability

The product asks what someone would *want* to do. It never treats an empty calendar slot as a yes.

**Why.** An empty Tuesday can be protected downtime, a night with no childcare, too far to travel, too expensive this week, or simply not a night you feel like people. The research names this directly: *feasibility* and *social availability* are two different layers, and only their intersection should produce a suggestion. This is also our sharpest differentiator from every shared-calendar product in the category.

**Design consequence.** The availability interface is an act of intent, and its language says so &mdash; first person, active, opt-in: "times I'd actually be up for", never "when are you free". Calendar data, when we eventually read it, only ever *removes* options; it never *proposes* them, and it never leaves the device.

**Forbids.** Pre-filling someone's answer from their calendar. Showing free/busy as though it were a reply. Any screen that displays one member's schedule to another. Framing a non-answer as availability.

**Test.** Read the availability screen's labels aloud. If any of them could appear in a work scheduling tool unchanged, rewrite them.

### 3.4 Show the trade-off; never hide the maths

We recommend, we don't decide. Every option we surface says who's in, who's out, who hasn't answered, and why it ranked where it did. A human makes the call.

**Why.** The candidate algorithm is deterministic and explainable by design (spec &sect;5.6) precisely so the interface can be honest about it. The field research found that over 70% of successful group choices had majority rather than unanimous support &mdash; so quorum is right, but only if the group can see the cost of it. A recommendation nobody understands is a recommendation nobody trusts.

**Forbids.** A single "best time" with no reasoning. Heat maps and overlap grids the organiser has to interpret. Hiding who can't make it. Silently lowering quorum or dropping a required person. Ranking language that implies certainty we don't have.

**Test.** From any candidate on screen alone &mdash; no tapping through &mdash; a member can answer: who's coming, who isn't, who we're still waiting on, and why this one is first.

### 3.5 Nobody should feel turned down

Interest that doesn't reach the threshold expires quietly. A plan that fails names no one. Copy for rejection, expiry, non-response and missed cadence is emotionally neutral and forward-looking. This is a design surface, not a copywriting afterthought.

**Why.** The hesitant initiator is a named persona (spec &sect;4.3), and hypothesis H5 is that reducing the social risk of asking changes who asks. The research is explicit that anonymous features can intensify group dynamics rather than soften them &mdash; so the safety has to be built into what we *show*, not just what we store.

**Forbids.** Rejection counts. "3 people declined." Naming who ignored a request. Guilt framing, streak-loss framing, or any language that positions the group as failing. Read receipts on interest. Absolute anonymity promises we cannot keep in a three-person group.

**Test.** Read every empty, expired and failure state aloud to someone who has just been turned down by their friends. If it stings, it ships again.

### 3.6 One decision per screen

Each screen exists to move exactly one decision forward. The conversation lives in the group chat, where it already works and always will.

**Why.** Chat is explicitly out of scope (spec &sect;3) because existing group chats win. Our contribution is *structure* &mdash; the thing chat is bad at. Mixing the two makes us worse at both.

**Forbids.** Comments, reactions, threads, activity feeds. Two primary buttons competing on one screen. Settings surfaced in the middle of a flow. Cross-selling anything.

**Test.** Name the screen's single decision in one sentence. Anything not serving that sentence is secondary, quiet, or gone.

### 3.7 Restraint through the work, warmth at the outcome

The coordination screens are calm, fast and quiet. The confirmation is generous. Personality is spent where it means something &mdash; at the moment a plan becomes real &mdash; and withheld where it would slow someone down.

**Why.** The reviews praise playfulness (Partiful, Howbout) *and* complain about noise and clutter (TimeTree). Both are true. The resolution is not "medium personality everywhere"; it is knowing which screens are work and which screen is the reward. In the reference canvas this is why the confirmed screen is the only one that inverts to a dark ground.

**Forbids.** Decoration on the availability and candidate screens. Celebration for completing a form. Illustration in place of information. Personality that costs a reader a second.

**Test.** Cover the confirmation screen. Do the remaining screens feel efficient and unhurried? Uncover it. Does it feel like something good just happened?

### 3.8 Put the privacy promise where the risk is felt

Trust is shown at the exact moment of the ask, in plain words, in the interface &mdash; not in a policy page nobody opens.

**Why.** Calendar data reveals health appointments, employers, travel and empty houses. The market research treats trust as our strongest available differentiator in a category where the incumbent business model is calendar-adjacent advertising. The spec requires a privacy preview before availability submission and contextual explanation before any permission request.

**Forbids.** Permission requests without an in-context explanation of what we do and don't take. Bundled consent. Pre-ticked boxes. Legal language standing in for a plain sentence. Any screen where a person cannot tell what their friends will see.

**Test.** At every point where someone gives us something, they can see &mdash; without leaving the screen &mdash; what happens to it and who else sees it.

---

## 4. Voice

The product speaks like a considerate friend who is good at organising, not like software and not like a brand.

**It is:** plain, warm, specific, unhurried, and slightly Australian in cadence without being performative about it.

**It is not:** chirpy, urgent, clever, apologetic, or corporate.

Rules that carry most of the weight:

- **Say the thing.** "Send my times", not "Submit availability". "Lock it in?", not "Confirm your selection".
- **Second person for the reader, first person for their own data.** "Times I'd actually be up for" is the member's own voice; "Your friends only see a combined result" is ours, speaking to them.
- **Name people, not counts, wherever the count would sting.** "Doesn't work for Priya" reads as information. "1 unavailable" reads as a scoreboard.
- **No exclamation marks in the working screens.** One is permitted on the confirmation, and only if it earns itself.
- **No manufactured urgency.** Deadlines are stated as facts ("Replies close Tue 6 pm"), never as pressure ("Hurry &mdash; 3 hours left!").
- **Never blame the user or the group.** The subject of a failure sentence is the situation, not a person: "Not enough people were free this time", not "Your friends didn't respond".
- **Numbers are always paired with meaning.** "5 of 6 can make it" &mdash; never a bare "5".
- **Emoji are not part of the voice.** A member's chosen circle emoji is their content, not our tone.

---

## 5. The visual system

Chosen 31 August 2026. No design system pre-existed; this is the origin.

### 5.1 Colour

Warm, low-saturation ground; one confident accent; a single support hue. The palette is deliberately narrow so that colour always *means* something.

| Token | Value | Use |
|---|---|---|
| `ground` | `#FBF7F1` | Page background. Warm off-white, saturation kept very low. |
| `surface` | `#FFFFFF` | Cards and inputs. |
| `line` | `#EAE0D3` | Hairlines and card borders. |
| `line-soft` | `#F1E9DE` | Dividers inside a card. |
| `ink` | `#221E19` | Primary text. Warm near-black, never pure `#000`. |
| `ink-2` | `#6C6156` | Secondary text and body copy. |
| `ink-3` | `#796D61` | Labels, metadata, placeholders. Darkened from `#A0958A` to reach 4.5:1 on `ground` and `surface` (ADR 0034): it is text people read. |
| `accent` | `#C2542F` | Primary action, selected state, painted availability. |
| `accent-dark` | `#A0431F` | Accent text on light grounds; pressed state. |
| `accent-soft` | `#F6E5DC` | Accent-tinted surfaces and badges. |
| `support` | `#4F6B45` | Affirmative confirmation only. Never a status colour on its own. |
| `support-soft` | `#E6EDE1` | Affirmative surfaces. |
| `warn-surface` / `warn-ink` | `#FBF0E4` / `#6B5427` | Advisory notices, e.g. confirming while someone hasn't replied. |
| `invert-ground` | `#2E241C` | The confirmed screen, and nothing else. |
| `invert-accent` | `#E8A07A` | Accent on the inverted ground. |

**Rules.** Accent is reserved for the current action and the member's own choices &mdash; if everything is terracotta, nothing is. There is no red error colour and no green success colour in the ordinary palette: this product has few true errors, and dressing an ordinary outcome in traffic-light colour makes a social situation feel like a system failure. New colours are derived in OKLCH at the existing chroma and lightness, varying hue only.

### 5.2 Type

Two families, both with metric-compatible fallbacks because export and offline rendering will drop the webfont.

- **Display &mdash; Newsreader** (fallback `Georgia, 'Times New Roman', serif`). Dates, headlines, moments. Its warmth is what stops the product reading as a scheduling utility.
- **Interface &mdash; Figtree** (fallback `system-ui, -apple-system, 'Segoe UI', sans-serif`). Everything operational: labels, buttons, body, data.

| Role | Face | Size / line-height | Notes |
|---|---|---|---|
| Display XL | Newsreader 400 | 38&ndash;42 / 1.08, `-0.018em` | One per screen, maximum. |
| Display L | Newsreader 400 | 29&ndash;33 / 1.12, `-0.015em` | Screen titles. |
| Date | Newsreader 400 | 21&ndash;30 / 1.1 | Dates are set in the display face &mdash; they are the emotional content, not metadata. |
| Title | Figtree 600 | 15&ndash;17 / 1.3 | Row and card titles. |
| Body | Figtree 400 | 14&ndash;16 / 1.5 | |
| Small | Figtree 400/500 | 13 / 1.45 | Supporting copy. |
| Label | Figtree 600 | 12 / 1.3, `0.07em`, uppercase | Section labels only. Never for content. |

All times and counts use `font-variant-numeric: tabular-nums`. Body copy uses `text-wrap: pretty`.

### 5.3 Space and shape

- Screen gutter 20&ndash;24px. Section rhythm 20&ndash;26px. Related items 8&ndash;13px.
- Radii: pill 999 (rarely), control 11&ndash;14, card 16&ndash;22. Larger radius = larger element; never mix scales inside one card.
- Shadows are warm-tinted and barely there: `0 1px 2px rgba(74,55,38,.04), 0 14px 30px -20px rgba(74,55,38,.28)`. Elevation marks the primary action and the focused card &mdash; nothing else.
- Borders do most of the separation work. This is a bordered, not a shadowed, interface.
- **No fake device chrome.** Never draw a status bar, a keyboard, or a browser frame. The real ones render on top.

### 5.4 Components

- **Primary button.** 54&ndash;56px tall, accent fill, 14px radius, one per screen. Its label names the outcome, not the mechanism.
- **Secondary.** Same height, white fill, `line` border, `ink-2` label.
- **Tertiary.** Underlined text, `ink-3`, 44px tap area. Everything destructive or reversible lives here &mdash; quiet, never hidden.
- **Compact button.** Bordered, sized to its label, optional icon, 44px tall. For secondary actions inside a card or list (Done, Clear these days, Remove day, Start over, Undo), where underlined text at a card's edge reads as a stray link. `accent-soft` fill for the one a panel is waiting on (ADR 0024).
- **Chip / option.** 42&ndash;46px tall. Selected = accent fill plus a check glyph. Selection is never colour alone.
- **Card.** `surface` on `line`, 16&ndash;22px radius. The recommended option gets a 1.5px accent border, not a different fill.
- **Availability.** Days first, then a time once (ADR 0024). A **day grid**: seven columns under a weekday header, one toggle per day, 60px tall &mdash; a ticked day is `accent` plus a check, a day with times is `accent-soft` plus a short tag (Morn, Aft, Eve, Any, Some); seven columns become a wrapping list of named days when a column would be narrower than 44pt. **Block chips** carry their hours as a second line. The answer is always rendered *as text*, in a list of days and hours in words &mdash; the fill is the affordance, the text is the answer.
- **Availability track.** The half-hour row inside an opened day of that list: a ten-cell grid at 42px tall with 3px gaps, scrolling on the longer bands (ADR 0009).
- **Member marks.** Rounded squares with an initial, 25&ndash;30px, overlapped by 5px. A dashed outline means "hasn't answered" &mdash; never a greyed-out or crossed-through person.
- **Notice.** Warm surface, hairline border, icon plus one sentence. Used for advisory context, never for decoration.
- **Icons.** Inline SVG, stroke 1.6&ndash;1.8, round caps, on a 16/20/24 grid. One family, drawn not imported. Never emoji as an icon.

### 5.5 Motion

Motion confirms a state change and nothing else. 120&ndash;200ms, ease-out. Painting availability responds immediately with no transition &mdash; it must feel like a physical drag. The confirmation may have one moment of arrival; nothing else animates on entry. All motion respects `prefers-reduced-motion`.

---

## 6. Accessibility and inclusion &mdash; non-negotiable

These come from the spec (&sect;10) and are treated as correctness, not polish.

- **WCAG 2.2 AA** for contrast and interaction on mobile web.
- **Never colour alone.** Every availability state, attendance state and selection carries text or a glyph as well. A painted block is always accompanied by its time range in words.
- **44&times;44pt minimum** for anything tappable, including tertiary text links.
- **Dynamic type** to at least 200% without hiding a decision action. Layouts are flex/grid with `gap`; nothing is positioned by fixed height alone.
- **Screen-reader labels** on every date, time and availability control &mdash; the availability grid must be operable and comprehensible without sight of the fill.
- **Plain, neutral language** for every rejection, expiry and missed-cadence state.
- **Localisation readiness.** No hardcoded Melbourne, AUD, 12-hour clock, or date order in components or logic. Copy lives outside components. Times render from stored UTC plus an IANA zone.

---

## 7. The states every screen owes

A screen is not designed until all of these exist. From the spec's definition of done:

1. **Default** &mdash; the ordinary case.
2. **Empty** &mdash; before anyone has acted. Should teach, not apologise.
3. **Partial** &mdash; the honest middle. Some replies, some silence. This is the *most common real state* and gets designed first, not last.
4. **Loading** &mdash; only where a wait is real; otherwise optimistic.
5. **Error** &mdash; plain language, a correlation ID, and a way forward.
6. **Offline** &mdash; availability edits survive and resubmit.
7. **Permission denied** &mdash; full manual parity, no dead end, no nagging.
8. **Expired / cancelled** &mdash; neutral, final, blameless.

---

## 8. What we will never ship

A shorter list than the principles, and easier to check.

- A feed, a like, a follower count, or a public profile.
- Streaks, guilt, or "you haven't met in X" framing.
- A visible rejection count, or the identity of someone who didn't reply.
- A calendar grid on a phone that a person must interpret.
- Event titles or calendar contents leaving anyone's device.
- A paywall on knowing whether your friends replied. Core coordination is free, forever, for everyone in the circle.
- Advertising against calendar or relationship data.
- A permission request before value.
- Any claim, implied or stated, that this product treats loneliness.

---

## 9. Definition of done, for design

Before a screen is considered finished:

- [ ] Its single decision is stated in one sentence.
- [ ] Its target time-to-complete is stated, and met in a real test on a real phone.
- [ ] All eight states in &sect;7 exist.
- [ ] Nothing is communicated by colour alone.
- [ ] Every tap target is at least 44&times;44.
- [ ] It reads correctly at 200% type.
- [ ] Its failure and empty copy has been read aloud, from the point of view of the person it could hurt.
- [ ] Where it asks for something, it says on-screen what happens to it.
- [ ] It uses only tokens and components from &sect;5, or extends them deliberately and updates this document.

---

## 10. Open questions

Held here rather than resolved prematurely:

- **The product has no name.** The reference canvas uses "Rounds" as a placeholder, including in the sample invite link. The name will change the wordmark, the invite copy and probably the warmth of the voice.
- **How much personality the confirmation can carry** before it reads as a brand talking rather than a friend. Worth testing with the first real groups.
- **Whether the inverted confirmation screen survives contact with users**, or reads as showy.
- **How the availability track behaves at 200% type** &mdash; ten half-hour cells across a phone is the tightest constraint in the product, and the fallback (coarser blocks, or a vertical day view) is not yet designed.
- **Whether the calendar overlay's greyed conflicts can be shown without implying the product has read more than it has.** Slice 2 problem, but the trust framing needs designing before the feature does.

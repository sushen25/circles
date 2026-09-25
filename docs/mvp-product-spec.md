# MVP product specification v2: friend-group meetup coordination

_Status: approved for build_

_Date: 6 September 2026 (v1: 26 August 2026)_

_Codename: **Circles** — a placeholder; the public name is under validation (see [branding research](./research/branding-research.md)). In-product, the persistent group is called a **circle**; that word is not a brand claim._

_Primary test audience: the founder's 2–3 existing friend groups, followed by 8–10 groups with no close relationship to the founder, recruited by the founder in parallel with the build._

_Inputs: [meetup market research](./research/meetup-market-research.md), [consumer SaaS research](./research/consumer-saas-success-research.md), [software moats research](./research/software-moats-research.md), [branding research](./research/branding-research.md), [design manifesto](./design-manifesto.md), the [v1 spec review](./mvp-spec-review.md) with founder decisions, the [guest → app flow](./guest-to-app-flow.md), the [technical architecture](./technical-architecture.md), and the "Circles MVP UI" canvas (source in [`docs/design/`](./design/))._

_This version supersedes [v1](./initial-mvp-product-spec.md). A changelog is in §22._

## 1. Executive product decision

Build a mobile-first product for existing friend groups of 3–8 adults, roughly ages 25–40, who live in one city and already want to meet more often.

The product is not a shared calendar and is not another availability poll. It helps a group move through the entire coordination loop:

```text
Someone wants to connect
→ interest is expressed safely
→ socially viable times are collected
→ the best-enough option is surfaced
→ a person makes the final decision
→ everyone receives a confirmed plan
→ the app learns whether the meetup happened
→ the group is prompted at the right time to connect again
```

The MVP's concrete promise is:

> **Turn "we should catch up" into a confirmed meetup without the scheduling spiral.**

Its broader emotional promise is:

> **Help important relationships actually happen.**

The product must optimise for meetups reported as having happened. Calendar connections, invitations, responses, app opens, accounts and confirmed events are supporting measures, not the outcome.

### 1.1 What the group chat can already do, and what we add

As of August 2026, WhatsApp group polls have deadlines and can hide voter identities, and WhatsApp Events carry RSVPs with a "maybe". The incumbent can therefore already answer *whether* people are keen. Circles answers *when* enough of them can actually make it: willing time windows rather than a yes/no vote, a candidate engine that finds best-enough overlap under a quorum, a persistent circle that remembers the group, and an outcome loop that stays with the plan until it happened. Anonymous interest on its own is not the differentiator; the quiet ask is valuable only in combination with the rest of the loop. Invite and share copy names the specific gain rather than positioning against the chat.

## 2. What this MVP must validate

The first build is a behavioural experiment, not a small version of the eventual complete product.

### 2.1 Primary hypotheses

| ID | Hypothesis | Evidence the MVP should collect |
|---|---|---|
| H1 | Existing friend groups experience enough coordination friction to adopt a dedicated flow | Groups use the product for a real meetup without the founder operating it for them |
| H2 | A no-install response flow produces adequate group participation | At least 60% of invited members respond without individual chasing (measured by the organiser micro-survey, §5.10); returning web-only members reattach to their membership without owner intervention in at least 80% of cases |
| H3 | *(conditional, Slice 3)* Explicit social availability plus a private calendar overlay is more useful than manual entry alone | Tested only if Slice 1 shows availability entry, not motivation or reach, is the bottleneck |
| H4 | Quorum-based "best enough" recommendations move groups to a decision faster than waiting for unanimity | Groups confirm a plan even when not every person can attend or respond; the "replies closed, no decision" path is used rarely |
| H5 | Quiet initiation reduces the social risk of always being the person who asks | Members other than the usual organiser create a quiet ask; someone other than the initiator accepts the organiser role in at least one quiet plan; control condition: groups that have tried anonymous WhatsApp polls |
| H6 | A completed meetup creates a recurring reason to return | A meaningful proportion of groups initiate a second meetup within their chosen cadence; "take turns" nudges are acted on by someone other than the usual organiser |
| H7 | *(deferred)* The result has potential paid value | Not tested by a fake door in this MVP. Willingness to pay is explored in interviews after two happened meetups and tested later with a real checkout |
| H8 | Verified plan-update email gives web-only participants a reliable channel without harming activation | Anonymous participants verify an event email; response completion does not decline |
| H9 | A flexible response raises participation among passive members without degrading candidate quality | Share of responses that are "I'm easy"; candidate acceptance and reported outcome when flexible responders are in the majority |
| H10 | Guests convert to saved places and app installs at value moments, not gates | Conversions by moment (§5.11); guests who later start a circle |

### 2.2 What 2–3 friend groups can and cannot prove

The founder's groups are appropriate for finding broken flows, embarrassing copy, permission anxiety, notification problems, identity-continuity failures and whether the product helps a real meetup happen. They cannot establish market demand or willingness to pay because the sample is small, socially connected to the founder and unusually patient.

Treat the first cohort as a smoke test. Recruit at least 8–10 non-founder groups before interpreting retention signals. Recruitment starts now, in parallel with Slice 0, because it is the actual critical path to any retention evidence.

### 2.3 Discovery in parallel

Run 6–8 short interviews (organisers and passive members, interviewed separately) during Slices 0–1. Ask about the last meetup that was discussed but did not happen, who chases, which step took longest, whether the group has tried a WhatsApp poll or event for this, and what calendar details they would never share. Use the answers to tune copy, default windows, deadlines and quorum, which this spec otherwise sets by judgement.

### 2.4 Recommended validation period

Run each circle for 6–8 weeks. A shorter test validates one-off scheduling but not whether the product becomes a recurring relationship tool.

## 3. Firm MVP product decisions

| Decision | MVP choice | Reason |
|---|---|---|
| Initial audience | Existing local friend groups only | Keeps positioning and product language specific; couples and community organisers remain later modes |
| Product unit | A persistent private **circle** | Creates recurring context and retention beyond a one-off poll; the P0 compounding asset in the moats research |
| Participation model | Mobile web for no-install participation (the complete product loop); native app as an earned upgrade for recurring users | Avoids whole-group activation failure; nothing in the core loop is withheld from the web |
| Identity tiers | **Guest** (anonymous, device-bound), **saved place** (Apple, Google or email code; still web), **app installed** | Responding never needs an account; organising needs a saved place; the app adds only what a browser cannot do |
| Owner sign-in | Sign in with Apple, Sign in with Google, or email one-time code; no passwords | Fast first run; same identity links web and app |
| Identity continuity | **Continue as [name]** reattachment when a guest returns without a session; emailed re-entry links | Safari clears storage after 7 idle days and chat in-app browsers are isolated, so session loss is the normal path, not an edge case |
| Availability model | Members explicitly mark times they would socialise, or say they're flexible; an optional device-calendar overlay only removes conflicts (native, Slice 3) | "Calendar-free" is not the same as willing or able to meet |
| Calendar scope | Read selected device calendars locally for the active date window; never upload titles or raw events | Calendar-assisted validation without provider OAuth or privacy complexity |
| Planning modes | Named plan and quiet ask (the spec's "quiet spark") | Ordinary coordination and the social-risk hypothesis |
| Spontaneity | "Tonight" and "This weekend" presets within the same flow | Bounded spontaneity without a separate system |
| Auto-scheduling | Excluded | Explicit confirmation is safer and simpler |
| Decision rule | Quorum plus optional required members; the organiser confirms one of at most three explained candidates | Avoids waiting for unanimity while retaining human judgement |
| Chat | Excluded | Existing group chats win; the product structures the decision and shares back into them |
| Place selection | Optional free-text place, address or map URL after a time is chosen | Venue recommendation does not test the scheduling thesis |
| Notifications | Push for app users; **email for the signed-in organiser when no app is installed**; verified plan-update email for web-only participants; one-tap sharing to the group chat. Web Push is out of scope | The organiser loop works in Slice 1 without a native app |
| Email | Plan-update email only, verified, per plan, with no-sign-in unsubscribe. **Product-marketing consent is not in the MVP** (Slice 4 at the earliest); early-access interest is collected on the landing page instead | Removes a fifth of the v1 surface that tested the weakest hypothesis |
| Payments | Excluded; **no pricing fake door**. Willingness to pay is explored in interviews after two happened meetups | A fake door cannot fire usefully in the founder cohort and survey intent is weak evidence |
| Guest → app | Prompts only after a value moment, one tap to dismiss, capped; sign-in gate only for organising | See §5.11 and the guest → app flow |
| Public discovery | Excluded | Avoids marketplace cold start and stranger safety |
| Web hosting and links | Custom domain from Slice 1; per-link Open Graph previews carrying the circle name only | A trust-first product cannot ship invite links on a vendor subdomain; the chat preview is the first brand moment |
| Group size | 3–20 active members per circle ([ADR 0012](decisions/0012-circle-member-cap-of-twenty.md)) | Small enough to hold in your head; large enough for a book club or an extended family without splitting the circle |
| Age | 18+ in terms; not designed for minors | Australia's social-media minimum-age law is unlikely to apply but is deliberately broad |
| Geography | Globally usable, locally seeded in Melbourne | Time-zone-safe architecture without diluting early recruitment |

## 4. Users, identities and roles

### 4.1 Primary persona: the relationship organiser

The person who asks when everyone is free, follows up, interprets ambiguous replies, proposes a time and posts final details. Their job: "Help me turn the group's desire to meet into a real plan without making me chase and decide everything manually."

### 4.2 Secondary persona: the willing but passive friend

Wants to attend but delays checking the calendar, does not want another app, dislikes committing early or assumes someone else will organise. Their job: "Let me give a useful answer quickly without setup, oversharing or becoming responsible for the whole plan."

### 4.3 Tertiary persona: the hesitant initiator

Would like to see the group but avoids asking. Their job: "Let me discover whether others also want to meet before I expose myself or take on the organising work."

### 4.4 Identity tiers

| Tier | How it starts | What it can do | What it cannot do |
|---|---|---|---|
| Guest | Tapping an invite or plan link; a display name | Join, respond, see options and confirmations, add to calendar, confirm attendance, get plan-update email, reattach on return | Create circles, start plans or quiet asks, accept the organiser role |
| Saved place | Apple, Google or email code, on web or in the app | Everything a guest can, plus own circles, organise plans, keep their place on every device | — |
| App installed | Installing and signing in with the same identity | Everything above, plus push, on-device calendar overlay, native add-to-calendar, links opening in-app | — |

### 4.5 Authorisation roles

- **Circle owner:** a saved-place identity that created the circle. Can edit circle settings, rotate the join link, remove members, cancel plans, archive the circle and transfer ownership later.
- **Member:** any identity that has joined a circle. Can respond, see plan information, and (with a saved place) initiate plans.
- **Plan organiser:** the saved-place member who created a named plan, or the member who explicitly accepted the organiser role after a quiet ask reached threshold. A quiet plan has no organiser until someone accepts. Can confirm a time, add a place, edit, reschedule or cancel.
- **Removed member:** loses circle and plan access immediately; historic aggregate attendance may remain; their availability is deleted.

There is no public user directory, follower graph or contact upload.

## 5. MVP feature set

Every feature below is required unless marked as a slice-specific add-on. Each maps to artboards on the canvas; the mapping is maintained in `apps/app/src/features/README.md`.

### 5.1 First run, sign-in and invitee entry

#### Purpose

Get a new organiser from opening the app to a shared circle invitation with two typed inputs and no permissions; get an invitee from a link to a submitted answer with zero prompts.

#### First-time organiser flow (canvas page 0)

1. **Welcome**: brand line, one sentence, then Continue with Apple, Continue with Google, Continue with email. Terms line: no ads, no selling data, 18+.
2. **Email path only**: address → six-digit code (10-minute validity).
3. **Your name**: prefilled from the SSO provider; time zone taken from the device; both editable. No photo, phone number or contacts.
4. **First circle** (step 1 of 2): circle name and a loose cadence (weekly, fortnightly, monthly, every two months, no goal). Nothing else.
5. **First plan with defaults accepted** (step 2 of 2): one card summarising the defaults (catch up, next 14 days, evenings and weekend days, about 2 hours, a quorum that follows the circle as people join, replies close in 3 days); **Ask the group**, **See if people are keen instead**, or the quiet **Just invite people for now**.
6. **Paste to chat**: what lands in the chat, the plan's link and the paste-ready message; **Share to group chat**, **Copy**, then **Add my times**.
7. **The organiser's own times**: the availability editor for the plan just made, then the sent screen, then circle home, finding a time.

**The first thing shared is a plan, not an invite** ([ADR 0026](decisions/0026-first-run-shares-a-plan-and-a-defaulted-quorum-follows-the-circle.md)). A plan link carries the question the group chat was failing to answer, and it admits the people who tap it ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)), so one link does the work of two. The invite link and the circle-home-as-people-join screen are still the product's, reached from circle home and settings (§5.2) and from **Just invite people for now**; they are not steps in the first run.

Returning users land on the same Welcome; Apple and Google resolve to the existing account.

#### Invitee entry (canvas page 1)

- A circle invite opens a responsive mobile-web route. The link preview in the chat shows "Pick the times you'd actually be up for. No app needed." Nothing else. A **plan** link (`/j/<code>`, `/p/<code>`) also names the circle; a **circle invite** (`/join#<secret>`) cannot, because its secret lives in the URL fragment and a fragment is never sent to a server — so nothing that draws the card can know which circle it is ([ADR 0021](decisions/0021-the-link-preview-is-not-rate-limited.md)).
- Before any prompt the page shows: circle name, inviter's name, who is in so far, a one-sentence privacy statement, and the expected effort.
- **Choose my times** creates an anonymous session tied to that browser and asks for a display name. Duplicate active names in a circle are prevented; the owner can resolve accidents.
- **A plan link admits new people too, while the plan is taking answers** ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)). It is the link the group chat actually sees. Somebody new gives a display name and is a guest member of the circle and one of the people that plan is asking, in one step. A plan that is not taking answers — a quiet ask still gathering interest, a confirmed plan, a finished one — admits nobody, and the refusal is the same one a link that never existed gets. A quiet ask is never shared by link (§5.4), so nobody it needs is kept out.
- After the first useful response, a skippable **Get updates about this meetup by email** card appears (§5.8). Dismissal is one tap. No marketing checkbox exists.
- A tertiary **Save access on every device** link follows the email card; it explains that sign-in is an account and is separate from meetup email.

#### Identity continuity (Continue as)

- What somebody who is not a member sees on a plan link depends on who they are ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)). **Signed in with an account:** one tap, **Join [circle] as [name]**, and then the plan — never a list of names. **Anybody else:** the page lists the circle's guest members by display name only (no reply state) and offers **Continue as [name]**, **I'm new here** and **I have an account**. When the circle has no guest members the list is skipped and the page asks for a name.
- **I'm new here** asks for a display name and joins them while the plan is taking answers; otherwise it tells them to ask for the circle's invite link. **I have an account** signs them in and returns them to the same link. It exists because saved-place members are never on the list, so without it somebody with an account on a new device would be told their own name is taken.
- Reattaching moves the membership and its responses to the new session in one tap. The owner sees "Priya rejoined from a new device" on circle home. A member may reattach at most three times in seven days; a saved-place member can never be reattached to.
- Every plan-update email deep-links with a single-use re-entry token that authorises the same reattachment without the list.
- The web build is tested inside WhatsApp's and Messenger's in-app browsers, not only mobile Safari and Chrome.

#### Saving a place and the organiser gate

- Starting a named plan or quiet ask from the web requires a saved place: one screen (Apple, Google, email) worded as a practical need ("so we can find you again on any device"), linking the existing guest membership. Nothing already sent changes. Responding never requires it.
- A guest may also save their place voluntarily from the prompts in §5.11.

#### Acceptance criteria

- A new owner reaches a shareable **plan** link with two typed inputs (name, circle name) and no permission dialogs, and lands in the availability editor for that plan.
- An invitee reaches a submitted answer with zero account, permission or install prompts, **from the circle's invite link or from a plan link**; the email offer and every later prompt dismiss in one tap.
- A guest who returns with no session can reattach in one tap; the owner can see it happened; the reattach rate is instrumented.
- Organising from the web is gated on a saved place; responding is not.
- Google sign-in on web is configured per origin; the holding domain will be replaced before the external cohort, so re-verification is planned for.

### 5.2 Persistent private circles

#### Circle fields

Name; colour (solid, no image); primary IANA time zone defaulted from the creator's device; cadence (weekly, fortnightly, monthly, every two months, no goal); **nudge policy** (whoever organised last, take turns, the owner — default "take turns" for circles of four or more); default duration (60, 90, 120, 180, 240 or 300 minutes; default 120); default quorum `max(2, ceil(active members × 0.6))`, editable per plan; optional default area; active or archived; `last_met_at`; cadence snooze.

#### Joining and membership

- The owner shares one revocable circle link. Joining is immediate in the private beta; the owner can remove a member and reset the link without disturbing existing members.
- A plan's link also admits new members, but only while that plan is taking answers, and it cannot be revoked short of confirming or cancelling the plan ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)). Resetting the circle link does not affect it.
- Active members per circle: minimum 3 for quorum defaults, maximum 20 ([ADR 0012](decisions/0012-circle-member-cap-of-twenty.md)).
- The interface shows who has joined but never exposes one member's availability to another as a personal schedule.

#### Circle home

Three designed states: **finding a time** (active plan card with reply count and deadline), **locked in** (next confirmed meetup with going count), and **about time** (cadence nudge with snooze and turn-off). Every state shows last caught up, next one, members and the invite link, and a single primary action. Cadence copy is "No rush", "Next one's due soon", "Nothing yet", "No goal set"; never "on track", "overdue" or a count of days since.

No feed, chat, status posts, likes or generic calendar.

#### Acceptance criteria

- A circle remains usable for multiple meetup attempts; the second plan inherits duration, time zone, area, quorum and category.
- The owner can reset the join link without disrupting existing members.
- Archiving stops all prompts and preserves confirmed-meetup history.

### 5.3 Named meetup plan

#### Required plan inputs

- Intent: **Catch up** default; presets dinner, drinks, coffee, activity.
- Date window: tonight; this weekend; next 7 days; next 14 days; custom (calendar picker, capped at 30 consecutive days — ADR 0030).
- Time-of-day window with preset defaults: tonight from now rounded up to the next 30 minutes until 11:30 pm; weekdays 5:30–10:30 pm; weekend days 9:00 am–10:30 pm; custom.
- Duration: 60, 90, 120, 180, 240 or 300 minutes (the last two by ADR 0031).
- Quorum (defaults from the circle; required members count toward it). A plan records whether its quorum was **chosen** — supplied by the organiser or by the circle's own default — or **defaulted**. While it is defaulted it follows the plan's own audience: every join through the plan's link recomputes it as `max(3, quorum default for the number of people the plan is asking)` and adjusts the plan, keeping every answer. Somebody who joins the circle another way and never opens the plan is not one of them — joining an active plan is an opt-in (§9), and a quorum above the people who were asked is one the plan can never reach ([ADR 0026](decisions/0026-first-run-shares-a-plan-and-a-defaulted-quorum-follows-the-circle.md), adjusted per [ADR 0017](decisions/0017-changing-a-quorum-or-a-deadline-adjusts-a-plan-it-does-not-revise-it.md)). A plan made on a circle of one — the first-run case — therefore asks for three people rather than two, and grows with the chat. The organiser setting a quorum makes it chosen, and a chosen quorum never moves by itself.
- Required members, optional; the organiser is required by default.
- Response deadline defaults: tonight — the earlier of 60 minutes after creation and 30 minutes before the last possible start; this weekend / next 7 days — 24 hours; next 14 days — 72 hours. Editable, never after the last possible start. When a default would fall at or before creation — tonight's margin, on a plan whose last possible start is under 30 minutes away — the default becomes the last possible start rather than the plan being refused ([ADR 0010](decisions/0010-tonight-deadline-gives-up-its-margin.md)).

#### Plan creation result

- One at a time: a circle has at most one plan finding a time (`collecting` or `ready`). While one is, **Plan a catch-up** shows that plan — with **Edit** for its organiser and **Cancel** for the organiser or the owner — instead of the setup form; `create-plan` refuses a second (`plan_in_progress`), and so do **Change the time** on a locked-in plan and a quiet ask reaching its threshold ([ADR 0033](decisions/0033-one-open-plan-per-circle.md)).
- Visible to all current circle members; creator is organiser.
- A paste-ready message and short link for the group chat (the plan short link carries no secret; the circle invite secret stays in the URL fragment).
- App members receive one push; the organiser receives organiser-kind notifications by email if no app is installed; verified email subscribers receive nothing until confirmation.

#### Editing

The organiser can edit window, duration, quorum, required members and deadline until confirmation. An edit that invalidates responses creates a new revision, clears the affected responses and shows, before saving, exactly who will be asked again (including anyone who had not yet answered).

#### Acceptance criteria

- Creating a plan takes under 60 seconds with defaults accepted, and one tap on the first-run path.
- The plan-shared screen gives the organiser the message without composing.

### 5.4 Quiet ask

#### Purpose

Test whether private, threshold-based interest makes initiation feel safer and distributes organising labour.

#### Behaviour

1. A saved-place member chooses **See if people are keen** rather than **Plan openly**, picks a window (tonight, this weekend, next 7 days, next 14 days), optionally a category, and when to stop asking (tonight 9 pm; Friday midday for a weekend ask; in two days for a week or a fortnight; when the window starts). The stop time is always before the meetup could no longer start — after now and before the window's last possible start — and only the options that meet that are offered ([ADR 0035](decisions/0035-the-quiet-ask-at-twenty-members.md)). A circle of one has nobody to ask and cannot make one.
2. The initiator counts as keen. Members receive an aggregate prompt: "Someone in Sunday Crew would be up for a catch-up this weekend. Would you?" with **I'm keen** and **Not this time**.
3. While seeking interest, nobody, including the initiator, sees counts or individual answers. The initiator sees only the close time and the threshold.
4. The threshold is `min(n, max(3, ceil(n / 4)))` for `n` active members when the ask is made — three for circles of up to twelve, a quarter of the circle above that, five at twenty ([ADR 0035](decisions/0035-the-quiet-ask-at-twenty-members.md)). It is fixed when the ask is made and is not editable in MVP.
5. **When the threshold is met the plan moves to availability collection with no organiser.** The initiator receives a private prompt: **I'll organise** (their name shows as organiser, not as initiator) or **Ask for a volunteer** (every keen member sees a one-tap **I'll pick the time**; first to accept becomes organiser). If nobody accepts before replies close, the circle owner receives a neutral nudge and may then take the role. Interest closes when the ask opens, so the keen count shown from then on never changes. Plan copy says "started quietly" and never names who asked, before or after.
   If the circle already has a plan finding a time when the threshold is met, the ask is held: it stays as it was, shows nobody anything new, and opens as soon as that plan is no longer finding a time — or closes at its stop time like any other ([ADR 0033](decisions/0033-one-open-plan-per-circle.md), [ADR 0035](decisions/0035-the-quiet-ask-at-twenty-members.md)).
6. Members who said "not this time" see the opened plan and may still add their times.
7. If the threshold is not met by the stop time, the ask closes privately. The initiator sees "Not enough people were free this time." No list of who answered what is ever shown.

#### Safety boundaries

Quiet asks exist only inside a private circle; there is no anonymous text or targeting; the initiator is recorded server-side for abuse handling; members can mute quiet asks per circle; at most one active quiet ask per member per circle and three per circle in any seven days, whatever the circle's size — the limit is on what each member receives; in small groups the interface says people may still guess and never promises absolute anonymity. Notification and email copy for a quiet plan carries no organiser name until an organiser exists and never says who started it.

#### Acceptance criteria

- No UI, notification, email, log or analytics event can identify the initiator or an individual interest answer before threshold.
- A quiet plan cannot acquire an organiser without an explicit acceptance.
- Someone other than the initiator can become organiser.

### 5.5 Availability collection

#### Core interaction

- **Days first, then a time once** (ADR 0024). The active date window is a calendar grid, Monday to Sunday, one toggle per day; ticking days sets no time. A time panel then offers blocks for the ticked days — **Morning, Afternoon, Evening, Any time**, each with its hours — as checkboxes that paint or clear that block on every ticked day it exists on. Blocks that would paint the same hours are offered once, and a block that exists on only some ticked days says so. Days stay ticked until **Done**.
- The answer is always rendered as text: a **My answer** list, one line per day with times, the date and the hours in words. A line opens to adjust that day by the half hour — half-hour cells across the daily window, about ten visible at once, the row scrolling horizontally on the longer bands (ADR 0009) — with "Any time that day" and "Remove day". **Start over** clears every day and offers Undo until the next change.
- **Tonight** (a plan whose one day is today) opens with that day ticked and offers **From now** and **Later tonight** (from 9 pm, or an hour after now if later) instead of Morning, Afternoon and Evening.
- **Use my usual times**: a member with at least two earlier answers with times in the circle is offered, on an empty answer, a tertiary that paints their usual dayparts onto this plan's days and hours. It never sends, never replaces an answer, and says nothing about anybody who has not answered ([ADR 0005](decisions/0005-willing-windows-retained-12-months.md), [ADR 0037](decisions/0037-usual-times-are-read-not-written.md)).
- First-person willingness language: "Times I'd actually be up for".
- Plan-level **I'm easy — count me in for whatever works for most people** toggle (the flexible response).
- Explicit outcomes: submitted windows; flexible; interested but none of these dates work; **not enough notice — try me with more warning**; not this time. "None of these dates" opens a three-way choice rather than a bare decline.
- Editing is allowed until confirmation or the deadline; drafts survive going offline and resubmit.
- The privacy line reads: "Your friends will only see a combined result. They won't see your calendar or a personal schedule view."

#### Optional device-calendar overlay (native, Slice 3)

Explained before the OS prompt; selected calendars only; reads only the plan's dates; greys busy cells the person can paint over; shows which calendars were read and when; denial leaves full manual parity with no nagging. Only chosen willing windows and a "used overlay" flag are uploaded.

#### Acceptance criteria

- Manual completion is identical on native and mobile web.
- Raw calendar data never crosses the device boundary (code-level interface and test).
- Median availability-entry time and the share of flexible and more-notice responses are instrumented.

### 5.6 Candidate generation and explanation

#### Definitions

A member is **available** for a candidate if their windows fully contain it or they answered flexible. Non-responders and "none work", "more notice", "not this time" are unavailable. A candidate is **eligible** when all required members are available, the available count meets quorum (required members count toward it), and it starts and ends inside the allowed window.

#### Algorithm

Deterministic and versioned; no LLM. Enumerate 30-minute starts in the circle's time zone; score; discard ineligible; rank by available count, then sets with at least one explicit-window member ahead of flexible-only sets, then earlier date, then earlier start; return at most three with date diversity; store input and scoring versions. Without an eligible candidate, return the closest near-misses and the single rule preventing confirmation.

#### Presentation

- **All active members** see the candidates before confirmation; only the organiser can confirm.
- Each option shows the date and time on the circle's clock, naming the zone when the reader's own device is in a different one and never because another member's is ([ADR 0032](decisions/0032-the-circles-zone-is-shown-when-the-readers-device-differs.md)), "5 of 6 can make it", the names who can attend, a non-judgemental exception ("Doesn't work for Priya", "Alex hasn't answered"), and an explanation of its rank ("Best attendance", "One fewer, weekend", "Also four, a day later"). Dashed marks denote people who have not answered and never appear inside the "can make it" set.
- Before any candidate exists the organiser sees a waiting state with what has come in; members see nothing until options exist.
- No quorum: the closest near-misses, the blocking rule, and three actions: lower quorum, widen the window, close this attempt. Quorum is never lowered silently.

#### Acceptance criteria

Identical inputs return identical candidates; DST, half-hour zones and cross-zone members are covered by tests; the organiser never interprets a heat map.

### 5.7 Decision and confirmation

- The organiser may confirm any eligible candidate before or after the deadline. The review screen shows who has not answered, takes place name, address or map URL and a note (280 characters), and freezes time and response set on confirmation.
- The review and confirmed screens write the time on the circle's clock, as the options do, and name the zone when the reader's own device is in a different one ([ADR 0032](decisions/0032-the-circles-zone-is-shown-when-the-readers-device-differs.md)). No screen knows another member's zone, so none says what time it is for them.
- **Replies closed with no decision**: a reminder at the deadline, and one more a day later if an option is still waiting to be locked in; a screen offering **Lock in [top option]**, **Hand this to someone else** (to a member the plan is asking who has a saved place), or **Give it one more day** — a day from now or from the deadline if later, never later than thirty minutes before the last possible start, once per revision, and saying so when there is no day left to give ([ADR 0039](decisions/0039-replies-closed-is-told-per-deadline-and-once-a-day-later.md)).
- Every member sees Going / Can't make it / To confirm from their response and may correct it.
- The confirmed screen generates a paste-ready message and link; web participants get an `.ics` download; app users get native add-to-calendar. (A Google Calendar template link for Android web is held to Slice 3.)
- **Change the time** reopens availability as a new revision and marks the previous confirmation superseded; members see "Thursday is off the table" and a fresh ask.
- **Cancel** takes an optional note, produces a final state, a paste-ready update, and never changes `last_met_at`.

### 5.8 Reminders and communication

#### Push (app members)

New named plan; quiet ask seeking interest (to everyone except the initiator); threshold reached (initiator: "do you want to pick the time?"; keen members: "choose your times"); deadline approaching (non-responders only, 24 hours before; 20 minutes before on a tonight plan, whose replies close within the hour); options ready (organiser); locked in / changed / off; one reminder two hours before (going members); did it happen (organiser, next morning); about time (one person only, per the nudge policy). Full copy is on the "Push copy" artboard. Push is asked for contextually in the app, only when a first reminder is due, never at onboarding.

#### Organiser email (no app)

The signed-in organiser receives options ready, replies closed with no decision, did it happen, and about-time nudges by email until they install the app. These letters carry no stop link: the organiser turns them off in the app, where they are signed in, and the footer of each one a switch can stop says where. **Emails about plans you organise** on notification settings is one switch for the person, not per circle, and stops options ready and did it happen; replies closed with no decision still comes, because a plan other people answered is waiting on the organiser alone, and its footer says so instead of pointing at a switch; the about-time nudge is stopped by that circle's **Nudges to plan the next one** ([ADR 0029](decisions/0029-an-organiser-turns-organiser-email-off-in-the-app.md)).

#### Quiet-ask initiator email (no app)

The initiator of a quiet ask receives two letters about their own ask, at their own confirmed address, until they install the app: **threshold reached** ("Enough people are keen. Do you want to pick the time?") and **closed without opening** ("Not enough people were free this time"). Each goes to the initiator alone, once; neither names anybody or carries a count; neither is sent for a withdrawn ask. Nobody else is ever emailed about a quiet ask before it opens. Once it has opened, if replies close with nobody in the organiser role, the circle owner's neutral nudge (§5.4) is a replies-closed letter of its own, to their own address ([ADR 0038](decisions/0038-the-quiet-asks-initiator-is-written-to-at-their-own-address.md)).

#### Plan-update email (web-only participants)

For a verified subscription to one plan: confirmed; time or place materially changed; cancelled; one reminder two hours before; did it happen. Never anything else. Verification link expires in 24 hours; resend invalidates the previous token; the verification email contains nothing but the link. Every event email carries **Stop emails for this meetup** and **Manage email preferences** links that work without sign-in and a single-use re-entry link. Subjects never include names beyond the circle's and never reveal quiet-ask state. Addresses are never visible to owners, organisers or other members.

#### Existing-chat sharing

Every plan state includes **Share to group chat** with generated text: invite, new plan, waiting ("We're waiting on 4 replies…"), locked in, changed, cancelled. **The one exception is a quiet ask still gathering interest, which has no share action and no generated text**: pasting its link would show the chat who started it, and the people it asks are already members, prompted inside the circle (§5.4, [ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)). Once it opens for times it is shared like any other plan. The invite secret rides in the URL fragment, so chat previews never see it. The app records that the share sheet opened, not whether a message was sent.

#### Rules

No repeated daily reminders; at most one deadline reminder per member per plan; quiet hours 9 pm–8 am local except confirmed and cancelled; every notification deep-links to a decision; delivery is idempotent per recipient, plan revision, kind and occurrence; hard bounces and complaints suppress immediately; nothing about activity, streaks or news, ever.

### 5.9 Cadence and repeat use

- A reported-happened meetup sets `last_met_at`; the next due date follows the cadence.
- Seven days before a monthly or two-monthly due date, or two days before a weekly or fortnightly one, the circle home shows **About time for the next one** and one person is nudged according to the nudge policy: whoever organised last, **take turns** (round-robin among members who attended the last happened meetup and are not muted, passing from whoever organised last to the next in join order; default for circles of four or more), or the owner. The nudged member's card says it is their turn; everyone else's does not name anybody.
- One push or email per cycle (the due date the last meetup sets), sent when the circle home starts showing **About time** and only if no plan is open (asking or locked in); a plan made, a snooze or a meetup before it is sent stops it, and it is not sent again until the circle next meets ([ADR 0036](decisions/0036-the-cadence-nudge-is-decided-once-per-cycle.md)). Someone who has turned **Nudges to plan the next one** off is never asked: under take turns the turn passes on, and under the other two policies nobody is asked. The owner can **Snooze a month** (the due date does not move); any member can **Turn off nudges** for themselves. No guilt or streak framing.
- **Plan another** pre-fills category, duration, quorum, area and a future window from the last happened plan.

### 5.10 Outcome confirmation and lightweight memory

- The morning after a confirmed meetup the organiser is asked **Did this catch-up happen?** — happened, cancelled, moved outside Circles, not sure — with an optional one-line note for the circle's record. Copy says nobody is scored and nobody is told who came.
- Members may tap **I was there** / **I couldn't make it** from circle home or the emailed link.
- **Organiser micro-survey**: on the confirmation review, "Did you have to chase anyone outside the app?" (no / one person / more than one); on the outcome report, "Did the plan change outside the app?". Two taps each; this is the evidence for H2.
- "Reported happened" = organiser says so; "corroborated happened" = at least one other member confirms attendance.

### 5.11 Guest → saved place → app

This section replaces v1's pricing prompt. The full map is in the [guest → app flow](./guest-to-app-flow.md) and on canvas page 5.

Two conversions, each with its own moments. A prompt appears only after the thing it would have helped with has just happened; it is one tap to dismiss; it shows at most once per moment per plan; after two "not now"s on an app prompt nothing appears for 30 days; nothing appears before an answer, in an email, or on the join and availability screens; installed members never see app prompts.

| Moment | Prompt |
|---|---|
| Times sent | Email updates card, then "save access on every device" as a tertiary link |
| Times sent **and** email given | "Rather have these on your phone?" — app (same updates as notifications, one reminder, clash greying next time) |
| Returned with no session | After Continue-as: "Keep your place for good?" — saved place. Second time: the app sheet |
| Meetup locked in | "Want a nudge on Thursday?" — app reminder, beside the always-available add-to-calendar |
| Wants to start a plan or quiet ask | **Gate**: sign in first (Apple, Google, email). Links the guest membership |
| Second response in the same circle | The app sheet, once |
| Morning after, tapped "I was there" | "Got another group that keeps saying we should catch up?" — start a circle (leads to sign-in on web; the app is offered inside, never before) |
| Signs in inside the app | Same identity; circles appear; chat links open in-app from then on; push asked when the first reminder is due |

The app sheet lists exactly four things: one reminder before each catch-up and a ping only when a decision needs you; grey out your clashes (on the phone, never uploaded); never rejoin again; start one with another group. Nothing else in the product sells the app. The email-then-app prompt and the locked-in nudge count as the same ask for the caps.

Pricing is explored in the post-meetup interviews and tested later with a real checkout, not a fake door.

## 6. End-to-end journeys

### 6.1 First-time organiser

```text
Welcome → Continue with Apple
→ name prefilled, time zone from phone
→ first circle: "Sunday Crew", about monthly
→ first plan, defaults accepted → "Ask the group"
→ the plan's message + link → shared to the group chat
→ "Add my times" → own availability sent → circle home, finding a time
→ Priya and Tom tap the link, add a name and answer; the quorum follows the circle
→ options arrive as replies come in → confirm Thursday → share "Locked in"
→ next morning: did it happen? → happened → last caught up updates
```

### 6.2 Guest, including a lost session

```text
Taps the link in WhatsApp (in-app browser)
→ Join → name → paints times → Send my times
→ email card → verifies → app prompt dismissed
→ ten days later taps "Locked in" in iMessage (Safari, no session)
→ Continue as Priya → confirmed page → add to calendar
→ "Keep your place for good?" → later
→ morning after: I was there → "another group?" → starts a circle → signs in
```

### 6.3 Quiet ask

```text
Tom (saved place) taps "See if people are keen" → this weekend → stop Friday midday
→ members get the aggregate prompt → Priya, Jess keen → threshold
→ Tom privately chooses "Ask for a volunteer" → Priya taps "I'll pick the time"
→ keen members choose times → Priya confirms → nobody knows Tom asked
```

### 6.4 Second meetup

```text
Cadence due → take-turns picks Jess → "About time for the next one" → Plan another
→ defaults pre-filled from last time → same link and identities → confirmed faster than the first
```

## 7. Information architecture

Every screen exists as an artboard in `docs/design/`; the canvas pages are the IA.

| Page | Screens |
|---|---|
| 0 First time, organiser | Welcome (Apple / Google / email), email, code, name, first circle, first plan, plan shared, availability, sent, circle home |
| 1 Guest path (web) | Join, continue as, name, availability, none of these dates, sent (email offer), check email (app prompt), email verified, email preferences, save access, candidates (member view), confirmed (guest), add to calendar, rescheduled, cancelled, attendance, invite link inactive |
| 2 Organiser path | First-run and populated circle lists, create circle, invite circle, circle home joining, choose how to start, plan setup, custom window, waiting, candidates, replies closed, edit plan, confirm review, confirmed (organiser), circle home locked in, change time, cancel, cancelled, no quorum, did it happen, circle home about time, plan another, circle settings, notification settings, account, privacy, founder diagnostics |
| 3 Quiet ask | Setup, initiator waiting, interest prompt, threshold reached (initiator), started quietly (keen member), started quietly (other member), expired |
| 4 Native (Slice 3) | Contextual push ask, calendar explanation, calendar picker, availability with overlay, calendar denied |
| 5 Guest → app | The map, locked-in nudge, app sheet, rejoined nudge, second-response nudge, after-attendance prompt, organiser gate, app first open |
| 6 States, copy, components | Empty circle, offline and error, email templates, push copy, share messages and link preview, components and tokens |

Calendar overlay, push registration and native calendar insertion are native-only; the web experience never appears broken without them.

## 8. State model and invariants

### 8.1 Plan state machine

```text
draft ─named──▶ collecting ─(eligible)──▶ ready ─confirm──▶ confirmed ─outcome──▶ completed
  └─quiet──▶ seeking ─threshold──▶ collecting (no organiser until accepted)
                └─stop time──▶ expired
collecting ─(edit)──▶ collecting (revision + 1)
collecting ─(last start passed)──▶ expired
ready ─(response change)──▶ collecting → recalculate
confirmed ─reopen──▶ collecting (revision + 1, previous confirmation superseded)
confirmed | ready | collecting ─cancel──▶ cancelled
```

### 8.2 Invariants

- Every plan belongs to exactly one circle; only active members see or act on it.
- Organiser roles belong to saved-place identities only; a quiet plan has no organiser until a member explicitly accepts.
- A plan revision has at most one active confirmation; a confirmed time never changes as a side effect of later responses.
- Raw device-calendar events never enter the backend.
- Availability is scoped to one plan revision and never reused silently.
- Quiet-ask initiator identity and individual interest answers are never exposed, before or after threshold.
- A reattachment moves a membership only within a circle the guest already belongs to, never onto a saved-place member.
- Plan-update email consent is scoped to one plan and is never a marketing consent.
- No client, log or analytics context ever holds a raw email address, token, note or event title. A plan's short code is not a token for this rule: it is in every link the product shares, by design, and what it admits to is bounded and visible ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)). It still stays out of analytics payloads and our own function logs.
- All plan times are stored as instants with the display IANA zone; state transitions are server-side and idempotent.

## 9. Edge cases that must be designed, not deferred

- A guest returns with no session (expected, not rare): Continue as; emailed re-entry; owner sees rejoins; duplicate memberships are removable by the owner.
- A guest joins twice from different devices before reattaching: the second device is asked for a different display name, because duplicate active names in a circle are prevented (§5.1); the owner sees two memberships and removes one.
- Membership changes during a plan: removed members are excluded on recalculation; new members may opt into the active plan. Opening the plan's own link is the opt-in: joining through it, or opening it as a member who was never asked, makes them one of the people it is asking. A quorum the organiser or the circle chose does not change when they do; a quorum nobody chose follows the plan's audience up, and never down ([ADR 0026](decisions/0026-first-run-shares-a-plan-and-a-defaulted-quorum-follows-the-circle.md), which narrows [ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md) on this one point).
- A required person leaves: the plan becomes ineligible until the organiser changes required members or cancels.
- Nobody meets quorum: near-misses and explicit resolution actions.
- Everyone meets quorum at many times: three distinct dates where possible.
- Deadline passes with no decision: reminder, then the replies-closed screen; the plan stays decidable until the last candidate start, then expires.
- The organiser wants out: hand-off to another member; the owner is the fallback.
- A candidate begins in the past: removed on recalculation.
- A member travels across time zones: local display with the circle zone visible; scoring on instants.
- DST change: zone-aware library and transition tests.
- Calendar permission partial, denied or revoked (Slice 3): manual parity, no data loss, no nagging.
- Invite link leaks: reset; existing memberships stay valid. A plan link that reaches the wrong people stops admitting anybody at its response deadline; before then only confirming or cancelling the plan closes it (a confirmed plan that is reopened admits again). Removing whoever joined tidies up, but the link still works and they can join again ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)).
- Email mistyped: only the verification message is sent; nothing activates; the contact expires in 7 days.
- Verification after the plan completed or was cancelled: no stale mail is sent.
- One verified address on multiple guest memberships in one plan: one copy per event; memberships are not revealed to each other.
- A suppressed address is resubmitted: no automatic reactivation; neutral guidance.
- The plan was organised outside the app after availability was collected: recorded as "moved outside", neither failure nor success.
- The initiator of a quiet ask withdraws it before threshold: closed privately, nobody told.

## 10. Non-functional product requirements

- Performance: first meaningful web content within 2.5 seconds on 4G; availability edits feel immediate and survive refresh; candidates for 8 members × 14 days computed in under 2 seconds end to end (under 50 ms in the engine).
- Accessibility: WCAG 2.2 AA on mobile web; never colour alone; 44×44-point targets; screen-reader labels on every date, time and cell; dynamic type to 200% without hiding decisions; plain, neutral copy for rejection, expiry and missed cadence.
- Compatibility: mobile Safari and Chrome, and the in-app browsers of WhatsApp and Messenger, are first-class test targets for every guest route.
- Localisation readiness: copy outside components; locale-aware formatting; IANA zones; no hard-coded Melbourne, AUD, 12-hour clock or date order in domain logic.
- Reliability: unique idempotency keys for every job; logged transitions; user-visible reference ids on errors; "last updated" wherever stale state could affect a decision.

## 11. Measurement plan

### 11.1 North-star metric

> **Reported-happened meetups per activated circle per month**, with corroborated meetups shown separately.

### 11.2 Funnel

| Stage | Metric |
|---|---|
| Circle acquisition | Circles created; source; expected member count |
| Invitation | Link-preview impressions are unobservable; join-link opens → joins → first response |
| Activation | Circle confirms first meetup within 7 days |
| Response | Members responding; time to first/median/last response; share flexible / more-notice / none-work; organiser chasing survey |
| Continuity | Returns with no session; reattachments; duplicate memberships removed |
| Decision | Plan creation → confirmation; quorum vs unanimity; replies-closed path used; hand-offs |
| Outcome | Confirmed → reported happened → corroborated happened |
| Retention | Second plan and second happened meetup within cadence; nudge policy and who acted |
| Quiet-ask value | Asks by usual/non-usual organisers; threshold rate; organiser accepted by initiator vs volunteer; expiry rate |
| Growth | Nudges shown/dismissed/tapped by moment; accounts claimed by moment; app first opens linked; guests who start a circle within 30 days |
| Calendar value (Slice 3) | Explanation viewed → granted; overlay used; entry time with/without |
| Trust | Calendar denial/revocation, leave, deletion, complaints, unsubscribe, bounce |

### 11.3 Required analytics events

Typed catalogue with a versioned payload schema; at minimum: `account_started`, `account_completed(provider)`, `circle_created`, `circle_invite_shared`, `circle_join_opened`, `circle_joined`, `session_missing_on_return`, `member_reattached(source: list|email)`, `duplicate_member_removed`, `plan_created`, `plan_shared`, `plan_edited`, `plan_expired`, `plan_cancelled`, `plan_rescheduled`, `quiet_ask_created`, `quiet_interest_answered`, `quiet_threshold_reached`, `organiser_accepted(role: initiator|volunteer|owner_fallback)`, `availability_started`, `availability_submitted(status)`, `candidate_set_generated`, `candidate_viewed(role)`, `candidate_selected`, `deadline_passed_action`, `meetup_confirmed`, `organiser_chased(answer)`, `share_opened(kind)`, `calendar_add_opened`, `ics_downloaded`, `email_updates_offered`, `email_submitted`, `email_verified`, `email_subscription_changed`, `organiser_email_changed(enabled)`, `email_delivery_result(code)`, `outcome_reported`, `attendance_confirmed`, `cadence_prompt_sent(recipient_role)`, `plan_another_started`, `app_nudge_shown|dismissed|tapped(moment)`, `account_claimed(moment)`, `app_first_open_linked`, `guest_started_circle`, and in Slice 3 `calendar_explanation_viewed`, `calendar_permission_result`, `calendar_overlay_used`, `push_permission_result`.

No names, emails, notes, tokens or event titles in any payload.

### 11.4 Decision gates

Founder cohort (qualitative targets): every test circle confirms at least one real meetup; at least 60% of members respond without one-to-one chasing (survey); median response after link open under two minutes, target under 60 seconds; at least 70% of confirmed meetups reported happened; at least 80% of returns-without-session reattach without owner help; at least one group initiates a second meetup; at least one non-usual organiser starts a plan or quiet ask; at least half of guests who submit an email verify it.

External cohort: at least 50% of activated circles confirm within seven days; at least 30% of successful circles initiate another within cadence; conversions to saved place and app arrive at value moments rather than only at the organiser gate; willingness to pay is then tested with a real transaction.

## 12. Architecture summary

The implementation is specified in the [technical architecture](./technical-architecture.md). Product-relevant decisions:

- One Expo SDK 57 universal app (iOS, Android, web) with Expo Router; web output in `server` mode on **EAS Hosting Starter** with a custom domain, using one server route for link previews only.
- Supabase (Auth with Apple, Google, email OTP and anonymous sign-in; Postgres with row-level security; Edge Functions; pg_cron), Resend for transactional email, Cloudflare Turnstile on anonymous joins, Expo Push in Slice 3.
- Domain-driven design with seven bounded contexts and a pure, shared domain package containing the candidate engine and state machine.
- No Realtime in Slice 1 (refetch on focus); no Sentry until Slice 3; no marketing-email machinery; no Web Push.
- Data retention: willing windows kept 12 months for members of active circles with a coarse "usual day-parts" summary; other retention as in the architecture §8.5.

## 13. Security and privacy commitments

The architecture holds the controls; the product commitments are:

- Nobody's calendar leaves their phone; friends only ever see a combined result.
- A quiet ask never reveals who asked or who answered what, in any surface.
- Email is optional, per meetup, verified, and stoppable without sign-in; addresses are never shown to other members or sold, shared or enriched.
- Invite links can be reset; leaving, deleting and exporting are always available.
- The product is for adults (18+) and is not designed for minors.
- No advertising against calendar or relationship data, ever.
- Australian Spam Act and OAIC guidance are the baseline; legal review precedes any public launch. This is product guidance, not legal advice.

## 14. Cost model

Validation run-rate: Supabase Free (moving to Pro at US$25/month before the external cohort), EAS Starter US$19/month, Resend Free, a holding domain. Slice 3 adds Apple Developer (US$99/year) and Google Play (US$25 once). No SMS, mapping, AI, payment or analytics vendors.

## 15. Delivery plan

| Slice | Scope | Exit |
|---|---|---|
| **0 Foundation** | Monorepo, tokens and components from the canvas, routes with fixtures, Supabase local stack with migrations and seed, CI, `AGENTS.md`; interviews and external-cohort recruitment start | An agent can clone, run one command, open web and native, and walk the fixture flow |
| **1 Web end-to-end** | First-time organiser flow with Apple/Google/email; circle and invite with preview; guest join with continue-as; named plan; availability with flexible and none-work; engine; candidates (organiser and member); confirm, confirmed, share messages, `.ics`; edit, reschedule, cancel; outcome and attendance with the chasing survey; plan-update email with verification, preferences and re-entry; organiser email notifications; analytics | One real group confirms and reports a meetup with nothing installed; a guest who lost their session gets back in one tap |
| **2 Relationship loop (web)** | Quiet ask with organiser acceptance; tonight and weekend presets; cadence with take-turns nudges; plan another; corroborated attendance; replies-closed handling; guest → saved-place prompts | A non-usual organiser initiates; a circle returns; someone other than the initiator organises a quiet plan |
| **3 Native** | Development builds and TestFlight/Play internal; calendar overlay; contextual push; native add-to-calendar and the Google Calendar link; universal links; app prompts and app landing; Sentry | Manual vs calendar-assisted response effort compared in a real plan; chat links open in-app |
| **4 Hardening** | Rate limits and abuse tests; RLS audit; accessibility pass; DST matrix; retry UI; privacy pages and deletion; diagnostics export; product-marketing consent only if still wanted | Safe for a broader external beta |

Slice 1 is the most important release; test it in one real group chat before adding anything else.

## 16. Definition of done, for every feature

Acceptance criteria pass; the eight screen states exist (default, empty, partial, loading, error, offline, permission denied, expired/cancelled); analytics event emitted and schema-tested; RLS or database test exists; copy lives in the copy files with no exclamation marks on working screens; no sensitive data in logs or analytics; seed scenario and the canvas mapping updated; an ADR written if a rule changed.

## 17. Risks and explicit mitigations

| Risk | MVP response |
|---|---|
| Founder friends are overly cooperative | Smoke test only; external cohort recruited from day one |
| Guests lose their session and give up | Continue-as, emailed re-entry, in-app-browser testing, reattach rate as a gate |
| The group chat's own polls and events feel sufficient | Differentiate on willing time, quorum, persistence and outcome; ask about it in interviews |
| Universal Expo web feels insufficient | Measure route-specific problems before splitting the web client |
| Web-only members miss updates | Verified plan-update email; share-sheet messages for those who skip it; organiser email in Slice 1 |
| Conversion prompts damage trust | Value-moment rule, one-tap dismissal, caps, no gates except organising, nothing in emails |
| Anonymous sessions create duplicates | Reattachment plus owner removal; rate limits on reattach |
| Candidate algorithm encodes unfair defaults | Explained ranks, named attendance, human choice, versioned scoring |
| Quiet ask can be inferred | No absolute-anonymity claims; whole-circle prompts; threshold three; organiser acceptance step |
| Push and cron introduce duplicates | Persisted jobs with unique idempotency keys |
| Calendar permission undermines trust (Slice 3) | Explanation before the prompt, local-only architecture, manual parity |
| Agents introduce architectural drift | Authoritative spec and architecture, ADRs, thin routes, strict schemas, migrations, RLS tests, one CI command |

## 18. Explicitly excluded from the MVP

Couples or community-organiser modes; contact upload and friend discovery; direct WhatsApp, iMessage, Messenger or SMS integration; chat or comments; provider calendar OAuth or background sync; automatic confirmation or calendar writes; venues, maps search, reservations, payments, split bills, transport; public profiles, feeds, likes, discovery; photo albums; AI scheduling or venue generation; subscription billing and any pricing fake door; product-marketing email consent; Web Push; Realtime subscriptions; desktop calendar administration; claims to treat loneliness; accounts for under-18s.

## 19. Post-MVP decision tree

- **Groups respond and meet but do not return**: the one-off job is valid; test cadence triggers, more circles, or organiser pricing before subscriptions.
- **Groups do not respond without chasing**: the bottleneck is motivation or reach; explore delegation, stronger deadlines or channel integration; do not add calendar sophistication first.
- **Reattachment rates are poor**: add personal short links per member in emails and consider a lighter identity claim before the app.
- **Manual availability works and the overlay adds little (Slice 3)**: do not build provider OAuth.
- **The overlay materially improves completion**: evaluate Google free/busy, then Microsoft, with narrow scopes.
- **Quiet asks are used by non-organisers**: develop bounded spontaneity and configurable thresholds.
- **Only the usual organiser uses quiet asks**: simplify or replace with rotating-organiser prompts.
- **Guests convert only at the organiser gate**: the value moments are misplaced or the copy is not landing; re-test before adding prompts.
- **Groups love it but will not pay**: test organiser and community pricing, annual circle plans, or a different commercial layer; never advertising on calendar data.

## 20. Final build recommendation

Start with Slice 1 and put it in one real group chat as quickly as possible. The highest-risk questions are whether a no-install, quorum-based flow changes a group's behaviour enough to produce a real meetup with less chasing, and whether guests can reliably get back in. Only after that succeeds should the project add the quiet ask and cadence loop, and only after those the native overlay and push. This order preserves the research priorities: produce a recognisable outcome quickly; remove activation friction for every invited participant; measure the real recurring behaviour; earn permission and complexity only after value; build trust into the architecture.

## 21. Open items

- Final product name and domain (branding validation); the holding domain will be replaced before the external cohort.
- Interview findings that may change default windows, deadlines and quorum.
- Whether "Tom volunteered to pick the time" on the started-quietly screen should stay named or become anonymous until confirmation (currently named; the organiser role is public by design).

## 22. Changelog from v1

| Area | v1 | v2 |
|---|---|---|
| Sign-in | Email code only | Apple, Google, email code; first-time flow designed end to end |
| Identity | Anonymous session; loss treated as an edge case | Three tiers; Continue-as reattachment and emailed re-entry as core flows; organising requires a saved place |
| Quiet ask | Initiator becomes organiser by default | No organiser until accepted; initiator chooses to organise or ask for a volunteer; initiator sees no counts while waiting; stop time always before the window |
| Availability | Windows, none work, not this time | Adds "I'm easy" (flexible) and "not enough notice"; privacy copy corrected |
| Candidates | Audience undefined | All members see candidates; only the organiser confirms; flexible-only sets rank below explicit ones; required members count toward quorum |
| Deadline | Contradictory "tonight" rule; no stall handling | Rule fixed; replies-closed screen with lock in / hand off / extend |
| Cadence | Nudge to owner or last organiser; "On track" copy | Nudge policy incl. take turns; audit-free copy |
| Email | Plan updates plus product-marketing consent machinery | Plan updates only; marketing deferred to Slice 4 or a landing-page waitlist |
| Pricing | Fake door after two happened meetups | Removed; interviews now, real checkout later |
| Conversion | Not designed | §5.11 and the guest → app flow, incl. the app prompt after times + email |
| Notifications | Push only; organiser had no channel in Slice 1 | Organiser email; Web Push explicitly out |
| Hosting | EAS Hosting free | EAS Hosting Starter, custom domain, per-link OG previews |
| Measurement | Chasing unmeasured | Organiser micro-survey; continuity and growth funnel rows; new events |
| Slices | Web → native → loop → hardening | Web → loop → native → hardening |
| Competitive frame | 2024 WhatsApp | August 2026 WhatsApp polls/events acknowledged; differentiation restated |
| Retention | Windows deleted after 30 days | 12 months plus day-part summary |
| Architecture sections | In the spec | Moved to `technical-architecture.md`; summary kept in §12 |
| Age and group size | Unstated | 18+; 3–12 members (raised to 3–20 in [ADR 0012](decisions/0012-circle-member-cap-of-twenty.md)) |

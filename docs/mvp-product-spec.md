# MVP product specification v2: friend-group meetup coordination

_Status: approved for build_

_Date: 6 September 2026 (v1: 26 August 2026)_

_The product is **Wenna** — "Plans with friends" ([ADR 0043](decisions/0043-the-product-is-wenna-and-confirmations-sign-off-with-the-day.md)); **Circles** is its codename and package scope. In-product, the persistent group is called a **circle**; that word is not a brand claim._

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
| Web hosting and links | Custom domain from Slice 1; per-link Open Graph previews carrying the circle name only, and the words "locked in" for a confirmed plan (ADR 0054) | A trust-first product cannot ship invite links on a vendor subdomain; the chat preview is the first brand moment |
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
- **A member who leaves, and an account that is deleted:** a member (guests included) can leave a circle, which ends their membership as a removal does; the owner cannot, and instead deletes their account, which hands the circle to the longest-standing saved-place member or archives it. Deleting an account signs the person out everywhere at once and shows them to others as "Former member"; their profile and private details are purged after 30 days. Anyone can download their own data, once a day ([ADR 0083](decisions/0083-an-account-is-deleted-at-once-and-purged-after-thirty-days-a-member-can-leave-and-everyone-can-export.md)).

There is no public user directory, follower graph or contact upload.

## 5. MVP feature set

Every feature below is required unless marked as a slice-specific add-on. Each maps to artboards on the canvas; the mapping is maintained in `apps/app/src/features/README.md`.

### 5.1 First run, sign-in and invitee entry

#### Purpose

Get a new organiser from opening the app to a shared plan link, with their own evenings already in it, through four typed inputs (the group's name, a first name, an email, the code) and no permissions; get an invitee from a link to a submitted answer with zero prompts.

#### First-time organiser flow (canvas page 0)

**No sign-in before value, for the organiser either** ([ADR 0053](decisions/0053-the-organiser-gate-moves-to-before-the-share.md)), and **four screens to the share** ([ADR 0090](decisions/0090-the-first-run-is-four-screens-to-the-share-and-the-organiser-answers-first.md)). From the website's **Start a plan**, the organiser names the group, picks their own evenings and accepts or adjusts the plan with no account. Nothing is created on the server until the code is accepted. Each screen holds its heading, one control and at most one short line, and no kicker label sits above a heading. A 2 px line under the top bar and "1 of 3" beside it say where the person is; the share has none.

1. **Who do you keep meaning to see?** (1 of 3): one field, whose label is the heading ("e.g. the name of your group chat"). Under it the first line of the message the group will get ("To Thursday Lot", a tinted bubble, "No app, no account."), filling in as they type. **Next**; the wordmark and a quiet **Sign in** for returning organisers. No cadence: a new circle is monthly, changed in circle settings.
2. **Which evenings could you do?** (2 of 3): "Friends get the same question." The window chips (**Monthly**, the next four weeks and the default, **Next 2 weeks**, **This weekend**); the guests' day grid over the window (tap or drag, a fill and a check, no transition; where seven columns would be narrower than 44 points it becomes the named-day list); **I'll add mine later**, only while nothing is picked; and the plan in one line, "Evenings · about 2 hours · replies close Sun 6 pm", with **Adjust**, a sheet for time of day, how long and when replies close, and **More options** to the full plan setup (§5.3) on the device's draft, with no quorum or required people and nothing sent. **Next** waits until a day is picked, and says so if pressed. The days are the organiser's own answer, held in the draft.
3. **Who's asking?** (3 of 3): first name and email, **Email me a code**, and the terms line (no ads, no selling data, 18+). Nothing else: no summary of the plan, no paragraph, no time zone (the device's, editable in Account). Apple and Google arrive with SUS-77. Abandoning here creates nothing in the database.
4. **The code** (3 of 3): "Sent to {address}." Six boxes that send themselves on the sixth digit, typed, pasted or filled by the device; no Continue. A status line says "Checking", then "Setting up {group}" while the name is saved to the profile and `create-circle`, `create-plan` and the organiser's own answer run, in that order. **Send another** after 30 seconds. Every failure keeps what was chosen: a wrong or expired code clears the boxes, too many tries says to wait, and a failed set-up says so with a reference, **Try again** and **Back to the plan**; a time that went by offers **Change the time**.
5. **The share**: "Ask {group}.", the same bubble with the real link, "Replies close Sun 25 Oct, 6 pm. We'll email you the best times." (§5.8 does), **Share to group chat** and **Copy**; **Add my times** only when the organiser chose to answer later. When the share sheet closes: "Over to {group}.", "We'll email you when the best times are in.", the source question as a quiet card ("How did you hear about Wenna?", once per account, "Only counted, never tied to you."), **Go to {group}** and **Share again**. Nothing animates on arrival.
6. **Circle home, finding a time.**

A signed-in organiser goes 1, 2, share: the primary of screen 2 is **Make the link**, with no gate. The draft survives a reload and the sign-in round trip and expires 24 hours after it was last changed.

**The first thing shared is a plan, not an invite** ([ADR 0026](decisions/0026-first-run-shares-a-plan-and-a-defaulted-quorum-follows-the-circle.md)). A plan link carries the question the group chat was failing to answer, and it admits the people who tap it ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)), so one link does the work of two. The circle's invitation (**Add someone**) and the circle-home-as-people-join screen are still the product's, reached from circle home and settings (§5.2); they are not steps in the first run, and neither is **See if people are keen instead** (§5.4), which stays on circle home.

Returning organisers use the quiet **Sign in** on the first screen; Apple and Google resolve to the existing account.

#### Invitee entry (canvas page 1)

- A circle invite opens a responsive mobile-web route. The link preview in the chat shows "Pick the times you'd be up for. About a minute, and nobody sees your calendar." ([ADR 0043](decisions/0043-the-product-is-wenna-and-confirmations-sign-off-with-the-day.md)), with the product named only as the site. Nothing else. A **plan** link (`/j/<code>`, `/p/<code>`) also names the circle; a **circle invite** (`/join#<secret>`) cannot, because its secret lives in the URL fragment and a fragment is never sent to a server — so nothing that draws the card can know which circle it is ([ADR 0021](decisions/0021-the-link-preview-is-not-rate-limited.md)).
- Before any prompt the page shows: circle name, inviter's name, who is in so far, a one-sentence privacy statement, and the expected effort.
- **Choose my times** creates an anonymous session tied to that browser and asks for a display name. Duplicate active names in a circle are prevented; the owner can resolve accidents. That name is only what the circle calls them: co-members never see the name on a person's account, and renaming the account leaves every circle's name alone ([ADR 0065](decisions/0065-co-members-see-the-circles-name-for-a-member-and-nothing-else.md)).
- **A plan link admits new people too, while the plan is taking answers** ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)). It is the link the group chat actually sees. Somebody new gives a display name and is a guest member of the circle and one of the people that plan is asking, in one step. A plan that is not taking answers admits nobody. If its link is no longer live (a cancelled or expired plan, a quiet ask still gathering interest, a meetup more than 14 days past, an archived circle) the refusal is the one a link that never existed gets, "This link isn't active any more", with no name asked for; if it is still live (replies closed, or locked in recently) the person gives a name and is told "This plan isn't taking new answers. Ask someone in {circle} to add you.", never to ask for a link they have not seen ([ADR 0049](decisions/0049-continue-as-resolves-a-code-only-while-it-is-live.md), [ADR 0091](decisions/0091-circle-home-offers-one-way-into-the-chat-at-a-time-and-any-member-can-add-someone.md)). A quiet ask is never shared by link (§5.4), so nobody it needs is kept out.
- After the first useful response, a skippable card appears (§5.8): an address, the consent sentence, a **Save my place in {circle}** switch (on by default) and one primary, **Email me about this meetup** ([ADR 0055](decisions/0055-after-sending-one-step-keeps-your-place-and-turns-on-the-updates.md)). With the switch on, a sign-in code is emailed and entering it saves the place and turns on this plan's updates, with no verification link; off, the verification link and no account. **A signed-in member whose sign-in address is confirmed sees no field**: the card says "We'll email you at {address}." (that address, as text), then the consent sentence, then the one button; one tap turns this plan's updates on for it, with no link and no code, and goes to the done line. There is no "use a different address". A signed-in account with no confirmed address keeps the field and the link. If that address cannot be emailed (it bounced, was marked as spam or was unsubscribed from everything) its owner is told so and promised nothing: "We can't send email to {address} right now, so check the plan here." ([ADR 0055](decisions/0055-after-sending-one-step-keeps-your-place-and-turns-on-the-updates.md), section of 6 October 2026), whichever way they got there. With the switch on, the card also says an account is made and links the terms and privacy: "Makes you an account, so any phone gets you back in. Reminders to plan the next one can be stopped from the email." and "For people 18 and over. Read the terms and privacy." (words from [ADR 0092](decisions/0092-a-guests-pick-from-the-list-asks-first-and-the-sent-card-says-less.md), amending [ADR 0067](decisions/0067-every-cadence-nudge-carries-a-stop-link-and-the-sent-card-says-an-account-is-made.md); with the switch off, "Your place stays on this phone."; the button names both effects, **Email me and save my place**); the consent sentence is unchanged. Dismissal is one tap. No marketing checkbox exists, and no pre-ticked box: the button's own words are the consent.
- The separate **Save access on every device** screen is no longer reached from Sent; it remains behind the Continue-as prompt and the organiser gate.

#### Identity continuity (Continue as)

- What somebody who is not a member sees on a plan link depends on who they are ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)). Everybody who is not a member sees the circle's guest members by display name only (no reply state) and can pick **Continue as [name]**, or **I'm new here**. **Signed in with an account:** a pick moves that guest's place onto the account, and **I'm new here** is one tap, **Join [circle] as [name]**, and then the plan; with no guest members to list they go straight to that tap ([ADR 0088](decisions/0088-a-signed-in-account-can-continue-as-a-guest.md)). **Anybody else** also sees **I have an account**, and when the circle has no guest members the list is skipped and the page asks for a name.
- **I'm new here** asks for a display name and joins them while the plan is taking answers; otherwise it tells them to ask someone in the circle to add them. **I have an account** signs them in and returns them to the same link. It exists because saved-place members are never on the list, so without it somebody with an account on a new device would be told their own name is taken.
- Reattaching moves the membership and its responses to the new session in one tap and one confirmation: tapping a name opens "Carry on as Nina?" and only **Yes, I'm Nina** moves anything ([ADR 0092](decisions/0092-a-guests-pick-from-the-list-asks-first-and-the-sent-card-says-less.md)). The owner sees "Nina rejoined from a new device" on circle home. A guest may continue as themselves as often as they need to: there is no limit on how many times a membership moves ([ADR 0078](decisions/0078-a-guest-may-continue-as-themselves-as-often-as-they-need.md)); the hourly limits per circle and per address still apply. A saved-place member can never be reattached to *from the list*; an emailed link, though, may take a place back from a saved account whose own email is not the link's address (the founder's decision of 3 October 2026). If the account's own email is the link's address it is the same person signed in and keeps the place, and only that circle's membership moves: the account keeps everything else ([ADR 0049](decisions/0049-continue-as-resolves-a-code-only-while-it-is-live.md)).
- **A link offers Continue-as only while it is live** ([ADR 0049](decisions/0049-continue-as-resolves-a-code-only-while-it-is-live.md), [ADR 0059](decisions/0059-continue-as-resolves-plan-codes-only.md)). Only a plan link opens the list: a circle's own code opens nothing, and the database refuses a list move in a circle that has no live plan, whoever calls it. A plan link does while the circle is active and the plan is asking or has options on offer, or is locked in or finished and its meetup ended less than 14 days ago (the morning-after question and "I was there" are answered inside that window). A cancelled or expired plan, or an archived circle, lists nobody, and the person sees "This link isn't active any more." The limits are the database's: reattaching is refused in an archived circle and is rate-limited per circle whoever calls it.
- Every plan-update email deep-links with a single-use re-entry token that authorises the same reattachment without the list.
- The web build is tested inside WhatsApp's and Messenger's in-app browsers, not only mobile Safari and Chrome.

#### Saving a place and the organiser gate

- Creating a circle, a named plan or a quiet ask on the server requires a saved place ([ADR 0004](decisions/0004-organiser-requires-permanent-identity.md)). In the first run the screens that ask for it come **after the plan is drafted and before it is shared** ([ADR 0053](decisions/0053-the-organiser-gate-moves-to-before-the-share.md), [ADR 0090](decisions/0090-the-first-run-is-four-screens-to-the-share-and-the-organiser-answers-first.md)): "Who's asking?", a first name with the email, and the code (Apple and Google when SUS-77 lands). Nothing is created before the code is accepted, so abandoning it leaves nothing behind. The name is saved to the profile when the code is accepted and before the circle is made, so **Your name** is skipped. A guest who already belongs to a circle and starts a plan in it meets the same screens first, linking their existing membership. Nothing already sent changes. Responding never requires it.
- **After the share**, once the account, the circle and its plan exist, an account that has not been asked is asked once (a new account, or an older one the first time it makes a circle), "How did you hear about Wenna?": four one-tap answers (a friend's group, Reddit, a meetup or club, somewhere else) and Skip, with no typing (SUS-171; moved to after the share on 22 October, so it is never in the way of the link). It is a quiet card, never asked again of the same account, never at sign-in, and nothing waits on it. Someone who leaves before it has simply not answered: the founder funnel counts them as "not answered", never as a value. The answer is the `organiser_source` event and nothing else; it is not stored on the profile or beside a name or address, so the founder funnel can be read by channel without being read by person. An organiser who arrived on a link carrying a campaign tag (`?from=<tag>`) is not asked: the post is the answer, recorded as `content`, and skipping counts as asking ([ADR 0084](decisions/0084-a-campaign-tag-labels-a-circles-cohort-row-never-a-person.md)).
- A guest may also save their place voluntarily from the prompts in §5.11.

#### Acceptance criteria

- A new owner reaches a shareable **plan** link on the **fifth** screen, the third when signed in, with four typed inputs (the group's name, a first name, an email, the code), one sign-in and no permission dialogs. Their own evenings are in the plan when it is shared, unless they chose to add them later. The sign-in is the third screen, never the first. Each screen holds one decision and at most one short line besides its heading and controls.
- Abandoning before the code is accepted creates nothing in the database. A reload or an OAuth round trip at any step keeps the draft, including the organiser's days; a version 2 draft still in a browser reads as a draft with no answer; the draft is gone 24 hours after it was last changed.
- A signed-in organiser goes group → evenings → share with no gate.
- An invitee reaches a submitted answer with zero account, permission or install prompts, **from the circle's invite link or from a plan link**; the email offer and every later prompt dismiss in one tap.
- A guest who returns with no session can reattach with a tap on their name and a Yes; the owner can see it happened; the reattach rate is instrumented.
- Organising from the web is gated on a saved place, at the moment before the first thing is shared; responding is not.
- Google sign-in on web is configured per origin, against `wenna.app` (ADR 0044). Apple and Google sign-in are deferred past the founder cohort (SUS-77).

### 5.2 Persistent private circles

#### Circle fields

Name; colour (solid, no image); primary IANA time zone defaulted from the creator's device; cadence (weekly, fortnightly, monthly, every two months, no goal); **nudge policy** (whoever organised last, take turns, the owner — default "take turns" for circles of four or more); default duration (60, 90, 120, 180, 240 or 300 minutes; default 120); default quorum `max(2, ceil(active members × 0.6))`, editable per plan; optional default area; active or archived; `last_met_at`; cadence snooze.

#### Joining and membership

- The owner shares one revocable circle link. Joining is immediate in the private beta; the owner can remove a member and reset the link without disturbing existing members.
- A plan's link also admits new members, but only while that plan is taking answers, and it cannot be revoked short of confirming or cancelling the plan ([ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)). Resetting the circle link does not affect it.
- Active members per circle: minimum 3 for quorum defaults, maximum 20 ([ADR 0012](decisions/0012-circle-member-cap-of-twenty.md)).
- The interface shows who has joined but never exposes one member's availability to another as a personal schedule.
- **A member changes the name one circle calls them from that circle's settings** ("Change my name here", on their own row), without leaving and rejoining. It is the join screen's name field and rules; the account name and every other circle are untouched; the owner cannot rename anyone else; and the new name shows everywhere, a plan already locked in included ([ADR 0070](decisions/0070-a-member-changes-the-name-a-circle-calls-them-from-circle-settings.md)).
- **Who has saved a place, and who has muted what, is each member's own** ([ADR 0060](decisions/0060-a-quiet-asks-initiator-is-not-inferable-from-member-data.md)). Circle settings says "You · guest" or "You · place saved" on the reader's own row and "Joined 3 Sep" on everyone else's. Only the circle owner also sees "Guest" or "Place saved" beside each name. A member never reads another's mute switches, and nobody reads the rows of members who have left.

#### Circle home

Three designed states: **finding a time** (active plan card with reply count and deadline), **locked in** (next confirmed meetup with going count), and **about time** (cadence nudge with snooze and turn-off), with **replies closed**, **just you** and **new people joined** between them. Every state shows the members and a single primary action, and last caught up and next one once the circle has met.

**Circle home offers one way into the chat at a time** ([ADR 0091](decisions/0091-circle-home-offers-one-way-into-the-chat-at-a-time-and-any-member-can-add-someone.md)), named by what it does, never "link":

| State | The way into the chat | Add someone |
| --- | --- | --- |
| Finding a time (a plan takes answers) | **Share the plan**, "Anyone new can join from it too." | not shown |
| Replies closed, not locked in | none on the card; the organiser's primary is **Pick a time** | shown |
| Locked in | **Send the details**, "For people already in Sunday Crew." | shown |
| About time, or between catch-ups | none | shown |
| Just you, or new people joined | **Plan a catch-up** is the primary | shown |

**Any active member can add someone**, guests included. **Add someone** sits at the right of the members' marks whenever no plan takes answers, and opens the invitation as a message to share or copy. Settings opens with who is in, then Add someone; **Cancel old invitations** is the owner's alone, because it cuts off invitations already in a chat, and its sheet says plans already shared keep working. Cadence copy is "No rush", "Next one's due soon", "Nothing yet", "Whenever suits" (a circle with no goal); never "on track", "overdue" or a count of days since.

No feed, chat, status posts, likes or generic calendar.

#### Acceptance criteria

- A circle remains usable for multiple meetup attempts; the second plan inherits duration, time zone, area, quorum and category.
- The owner can reset the join link without disrupting existing members.
- Archiving stops all prompts and preserves confirmed-meetup history.

### 5.3 Named meetup plan

#### Required plan inputs

- Intent: **Catch up** default; presets dinner, drinks, coffee, activity.
- Date window: tonight; this weekend; next 7 days; next 14 days; **next 28 days**, the first run's "Monthly" and its default, which keeps the weekday evening band and stays inside the 30-day limit ([ADR 0090](decisions/0090-the-first-run-is-four-screens-to-the-share-and-the-organiser-answers-first.md)); custom (calendar picker of specific days — a tap toggles a day, dragging across days paints them in — the first and last at most 30 days apart, so a plan never asks about more than 30 days; ADR 0030, [ADR 0047](decisions/0047-a-plan-may-ask-about-days-with-gaps.md)). A custom plan may have gaps: it asks about the days picked and no others.
- Time-of-day window with preset defaults: tonight from now rounded up to the next 30 minutes until 11:30 pm; weekdays 5:30–10:30 pm; weekend days 9:00 am–10:30 pm; custom.
- Duration: 60, 90, 120, 180, 240 or 300 minutes (the last two by ADR 0031).
- Quorum (defaults from the circle; required members count toward it). A plan records whether its quorum was **chosen** — supplied by the organiser or by the circle's own default — or **defaulted**. While it is defaulted it follows the plan's own audience: every join through the plan's link recomputes it as `max(3, quorum default for the number of people the plan is asking)` and adjusts the plan, keeping every answer. Somebody who joins the circle another way and never opens the plan is not one of them — joining an active plan is an opt-in (§9), and a quorum above the people who were asked is one the plan can never reach ([ADR 0026](decisions/0026-first-run-shares-a-plan-and-a-defaulted-quorum-follows-the-circle.md), adjusted per [ADR 0017](decisions/0017-quorum-and-deadline-adjust-a-plan-without-a-revision.md)). A plan made on a circle of one — the first-run case — therefore asks for three people rather than two, and grows with the chat. The organiser setting a quorum makes it chosen, and a chosen quorum never moves by itself.
- Required members, optional; the organiser is required by default.
- Response deadline defaults: tonight — the earlier of 60 minutes after creation and 30 minutes before the last possible start; this weekend / next 7 days / custom — **tomorrow at 6 pm**; next 14 days / next 28 days — **6 pm on the third day after**, counted in calendar days on the plan's own clock, so a plan made on a Thursday closes on Sunday at 6 pm whatever the hour ([ADR 0090](decisions/0090-the-first-run-is-four-screens-to-the-share-and-the-organiser-answers-first.md), replacing [ADR 0076](decisions/0076-day-based-deadline-defaults-round-up-to-the-hour.md)'s rounding up to the hour). Editable, never after the last possible start. When a default would fall at or before creation — tonight's margin, on a plan whose last possible start is under 30 minutes away — the default becomes the last possible start rather than the plan being refused ([ADR 0010](decisions/0010-tonight-deadline-gives-up-its-margin.md)).

#### Plan creation result

- One at a time: a circle has at most one plan finding a time (`collecting` or `ready`). While one is, **Plan a catch-up** shows that plan — with **Edit** for its organiser and **Cancel** for the organiser or the owner — instead of the setup form; `create-plan` refuses a second (`plan_in_progress`), and so do **Change the time** on a locked-in plan and a quiet ask reaching its threshold ([ADR 0033](decisions/0033-one-open-plan-per-circle.md)).
- Visible to all current circle members; creator is organiser.
- A paste-ready message and short link for the group chat (the plan short link carries no secret; the circle invite secret stays in the URL fragment).
- App members receive one push; the organiser receives organiser-kind notifications by email if no app is installed; verified email subscribers receive nothing until confirmation.

#### Editing

The organiser can edit window, duration, quorum, required members and deadline until confirmation. An edit that invalidates responses creates a new revision, clears the affected responses and shows, before saving, exactly who will be asked again (including anyone who had not yet answered). Taking away days that nobody's answer has times on does not invalidate anything: every answer is kept and no revision starts, and the screen says so before saving; adding a day, or taking away a day somebody picked, is a new question ([ADR 0047](decisions/0047-a-plan-may-ask-about-days-with-gaps.md)).

#### Acceptance criteria

- Creating a plan takes under 60 seconds with defaults accepted. On the first run it is the group's name and the evenings the organiser could do.
- The plan-shared screen gives the organiser the message without composing.

### 5.4 Quiet ask

#### Purpose

Test whether private, threshold-based interest makes initiation feel safer and distributes organising labour.

#### Behaviour

1. A saved-place member chooses **See if people are keen** rather than **Plan openly**, picks a window (tonight, this weekend, next 7 days, next 14 days), optionally a category, and when to stop asking (tonight 9 pm; Friday midday for a weekend ask; in two days for a week or a fortnight; when the window starts). The stop time is always before the meetup could no longer start — after now and before the window's last possible start — and only the options that meet that are offered ([ADR 0035](decisions/0035-the-quiet-ask-at-twenty-members.md)). A circle of one has nobody to ask and cannot make one.
2. The initiator counts as keen. Members receive an aggregate prompt: "Someone in Sunday Crew would be up for a catch-up this weekend. Would you?" with **I'm keen** and **Not this time**.
3. While seeking interest, nobody, including the initiator, sees counts or individual answers. The initiator sees only the close time and the threshold.
4. The threshold is `min(n, max(3, ceil(n / 4)))` for `n` active members when the ask is made — three for circles of up to twelve, a quarter of the circle above that, five at twenty ([ADR 0035](decisions/0035-the-quiet-ask-at-twenty-members.md)). It is fixed when the ask is made and is not editable in MVP.
5. **When the threshold is met the plan moves to availability collection with no organiser.** The initiator receives a private prompt: **I'll organise** (their name shows as organiser, not as initiator) or **Ask for a volunteer**. Every keen member already sees a one-tap **I'll pick the time** from the moment it opens, and the first to accept becomes organiser; **Ask for a volunteer** leaves the role to them rather than opening it ([ADR 0041](decisions/0041-keen-members-may-take-the-role-as-soon-as-it-opens.md)). If nobody accepts before replies close, the circle owner receives a neutral nudge and may then take the role. Interest closes when the ask opens, so the keen count shown from then on never changes. Plan copy says "started quietly" and never names who asked, before or after.
   If the circle already has a plan finding a time when the threshold is met, the ask is held: it stays as it was, shows nobody anything new, and opens as soon as that plan is no longer finding a time — or closes at its stop time like any other ([ADR 0033](decisions/0033-one-open-plan-per-circle.md), [ADR 0035](decisions/0035-the-quiet-ask-at-twenty-members.md)).
6. Members who said "not this time" see the opened plan and may still add their times.
7. If the threshold is not met by the stop time, the ask closes privately. The initiator sees "Not enough people were free this time." No list of who answered what is ever shown.

#### Safety boundaries

Quiet asks exist only inside a private circle; there is no anonymous text or targeting; the initiator is recorded server-side for abuse handling; members can mute quiet asks per circle; at most one active quiet ask per member per circle and three per circle in any seven days, whatever the circle's size — the limit is on what each member receives; in small groups the interface says people may still guess and never promises absolute anonymity. No member can read another's saved-place state or mute switches, because starting a quiet ask takes a saved place and is refused after muting: the owner alone sees who has a saved place ([ADR 0060](decisions/0060-a-quiet-asks-initiator-is-not-inferable-from-member-data.md)). Notification and email copy for a quiet plan carries no organiser name until an organiser exists and never says who started it.

#### Acceptance criteria

- No UI, notification, email, log or analytics event can identify the initiator or an individual interest answer before threshold. A guest's place taken from the Continue-as list does not bring the previous holder's answer with it; only a move that proves the person does ([ADR 0062](decisions/0062-a-continue-as-pick-does-not-carry-the-quiet-ask-answer.md)).
- A quiet plan cannot acquire an organiser without an explicit acceptance.
- Someone other than the initiator can become organiser.

### 5.5 Availability collection

#### Core interaction

- **Days first, then a time once** (ADR 0024, simplified by [ADR 0068](decisions/0068-a-tapped-day-has-a-time-and-the-answer-is-one-line.md)). The first screen asks one thing: *Which days could work?* Its parts are the question, one line of guidance ("Tap every day you'd be up for. The number is how many people can make it, you included once you tap."), the active date window as a calendar grid (Monday to Sunday, one toggle per day, landing empty), the deadline as a footnote ("Replies close Fri 23 Oct, 8:30 pm."), **Send my times** (waiting until a day is tapped or I'm easy is on) and "None of these dates work for me". Tapping a day gives it the current time of day (Evening, unless the plan has none) and tapping it again clears it. The number on a tile is the others who could make the day, and one more once the reader has tapped it; a day nobody else could make shows a quiet zero.
- Once any day is tapped, an **answer block** sits under the grid (ADR 0068, amended by ADR 0079): **When, on those days?** with the number of tapped days ("10 days"), a row of pills, **Evening** (from 5:30 pm), **Daytime** (9 am to 5 pm, morning and afternoon together) and **Any time**, one line with the chosen one's hours ("From 5:30 pm", "9 am–5 pm", "Any time"), and **Not the same every day?**. A pill applies to every tapped day. Each is clipped to the plan's hours, and the empty and duplicate ones are dropped. **When the plan leaves one window there is nothing to pick**: no pills; the first screen names the band by where it sits (wholly before noon, **mornings**; noon to 5 pm, **afternoons**; from 5 pm, **evenings**; anything else, **days**) — "Which evenings could work?", "None of these evenings work for me" — and the link is **Adjust hours**. **Not the same every day?** (or Adjust hours) swaps the block in place for **A time for each day**: a row for each tapped day in date order, with the same choices as small pills that set that day alone (none on a plan with one window) and a clock. A day whose hours match no choice selects none, lights its clock and says its hours. **Same for every day** swaps back with the last choice made for all days. The clock opens that day's hours on a sheet as **From – to** pairs: each pair two time buttons and a remove ×, a button opening a picker of the half-hour times that edge may take inside the plan's band for that day, **Add another time** for a gap in the day (pairs that touch or overlap merge), a thin bar of the band with the hours filled in, and one line about the others ("Most others can do 2–4 pm and 6–8 pm"; counts and times only, none when nobody else is free). **Done** closes the sheet, and **Back to Evening instead** drops the exact hours for the choice the day had. The half-hour cells stay the stored form (ADR 0009); nothing is painted. The block opens as the list when the days already differ, and its state is never stored or sent. Dragging across the grid taps or untaps the days it crosses. This is the only place a day can differ from the others.
- **Tonight** (a plan whose one day is today) offers **From now** and **Later tonight** (from 9 pm, or an hour after now if later) instead of Evening, Afternoon and Any time.
- **Previous times**: an answer that has never been given opens empty, whatever the person offered before in the circle: no day is tapped and no line is written until they tap, and nothing applies the earlier times on open ([ADR 0077](decisions/0077-an-answer-never-given-opens-empty-previous-times-wait-for-a-tap.md), over ADR 0068). They come back as an explicit tap. Under the deadline footnote, where the answer block will appear, a quiet pill, **Use my usual days**, with a small undo-style icon, and one line under it that says what the usual is in words ("Weekday evenings and weekend afternoons, from your last plans in this circle."), so the tap is never a surprise. It shows only to someone who has answered in this circle before, whose usual days fall inside this plan, and who has not answered this plan yet; a first-time guest never sees it, and it goes once any day is tapped by hand. Tapping it taps those days with their usual times, shows the answer block as for any answer (as "A time for each day" when the usual days have different times), and adds "Filled in from your usual days. **Undo**" under its hours line; Send is enabled. Undo returns to nothing tapped and brings the offer back. From the tap on it is an ordinary answer (days tapped off or on, the time-of-day pills, a time for each day, Send), and the note goes with the first change. The read is [ADR 0005](decisions/0005-willing-windows-retained-12-months.md) and [ADR 0037](decisions/0037-usual-times-are-read-not-written.md). `usual_offered` is true when the pill was on show as the editor opened; `usual_used` is true when the tap was used and the answer sent.
- **What others have said, as counts** ([ADR 0045](decisions/0045-the-editor-shows-what-others-have-said-as-counts.md)). Once at least one other member has answered with times, each day shows how many of the others could make it. Once two have, an open day's exact hours also carry a sentence that names the busiest stretch ("Most others can do …"); with exactly one, the hours say nothing about the others ([ADR 0066](decisions/0066-the-group-sees-who-can-make-each-option-and-nobody-sees-whole-availability.md)). Someone counts wherever they have any half hour in common, and an "I'm easy" answer counts everywhere. Counts are numbers and words, never names, never a colour ramp; below the threshold there is no number and the guidance line only says what to do. The counts are read each time the editor opens; a failed read shows none and changes nothing else.
- First-person willingness language: "Which days could work?", "Send my times".
- Plan-level **I'm easy — count me in for whatever works for most people** toggle (the flexible response).
- Explicit outcomes: submitted windows; flexible; interested but none of these dates work; **not enough notice — try me with more warning**; not this time. "None of these dates" opens a three-way choice rather than a bare decline.
- Editing is allowed until confirmation or the deadline; drafts survive going offline and resubmit.
- The privacy line reads: "Your friends will see who can make each suggested time. They won't see your calendar, or your whole availability with your name on it."

#### Optional device-calendar overlay (native, Slice 3)

Explained before the OS prompt; selected calendars only; reads only the plan's dates; greys busy cells the person can paint over; shows which calendars were read and when; denial leaves full manual parity with no nagging. Only chosen willing windows and a "used overlay" flag are uploaded.

#### Acceptance criteria

- Manual completion is identical on native and mobile web.
- Raw calendar data never crosses the device boundary (code-level interface and test).
- Median availability-entry time and the share of flexible and more-notice responses are instrumented.

### 5.6 Candidate generation and explanation

#### Definitions

A member is **available** for a candidate if their windows fully contain it or they answered flexible. Non-responders and "none work", "more notice", "not this time" are unavailable. A candidate is **eligible** when all required members are available, the available count meets quorum (required members count toward it), and it starts and ends inside the allowed window. An organiser's own time (§5.7, [ADR 0051](decisions/0051-the-organiser-sets-the-final-plan.md)) is outside eligibility and says so: eligibility decides what the engine offers, not what the organiser may decide. "Who can make this stretch" is the one rule above, applied to any stretch, and the engine and the organiser's picker read the same function.

#### Algorithm

Deterministic and versioned; no LLM. Enumerate 30-minute starts in the circle's time zone; score; discard ineligible; rank by available count, then sets with at least one explicit-window member ahead of flexible-only sets, then earlier date, then earlier start; return at most three with date diversity; store input and scoring versions. Without an eligible candidate, return the closest near-misses and the single rule preventing confirmation.

#### Presentation

- **All active members** see the candidates before confirmation; only the organiser can confirm.
- Each option shows the date and time on the circle's clock, naming the zone when the reader's own device is in a different one and never because another member's is ([ADR 0032](decisions/0032-the-circles-zone-is-shown-when-the-readers-device-differs.md)), "5 of 6 can make it", the names who can attend, a non-judgemental exception ("Doesn't work for Nina", "Alex hasn't answered"), and an explanation of its rank ("Best attendance", "One fewer, weekend", "Also four, a day later"). Dashed marks denote people who have not answered and never appear inside the "can make it" set. Every member sees these names, not only the organiser: the group sees who can make each option on offer, who cannot and who has not answered, and nobody sees anyone's whole availability with their name on it. A card is a verdict on one stretch and never shows a window; the public sentences about this say both things plainly and a domain rule keeps them true ([ADR 0066](decisions/0066-the-group-sees-who-can-make-each-option-and-nobody-sees-whole-availability.md)).
- Before any candidate exists the organiser sees a waiting state with what has come in; members see nothing until options exist. On a circle's first plan, 48 hours after it was made with no answer from anyone but the organiser, the waiting screen also asks the organiser one optional question, "Nothing in yet. What's happened?": *I haven't posted the link yet*, *I posted it, no one's replied*, *This isn't the right group for it*, or Skip. It is one tap with no typing, gates nothing, is asked once per plan and never to a member, and records only `first_plan_stalled(answer)` ([ADR 0085](decisions/0085-a-first-plan-nobody-answers-gets-one-question-and-one-letter-from-the-founder.md)).
- No quorum: the closest near-misses, the blocking rule, and three actions: lower quorum, widen the window, close this attempt. Quorum is never lowered silently. Widening asks about every day for thirty days from the first, dropping any gaps, and says so before it does ([ADR 0047](decisions/0047-a-plan-may-ask-about-days-with-gaps.md)).

#### Acceptance criteria

Identical inputs return identical candidates; DST, half-hour zones and cross-zone members are covered by tests; the organiser never interprets a heat map.

### 5.7 Decision and confirmation

- The organiser may confirm any eligible candidate before or after the deadline, **or any day and time of their own**: from an option, from no quorum, from replies closed and from the waiting screen before any option exists. An own time starts in the future, runs from 30 minutes to 5 hours on half hours in the plan's zone, and starts no later than the plan's last day plus thirty days; days the plan never asked about are allowed and say so. Before locking it in the organiser sees by name who it works for, who it does not and who has not answered, and is told plainly when it is below the plan's number or on a day nobody was asked about; the override is never silent, and the plan's number is not changed by it ([ADR 0051](decisions/0051-the-organiser-sets-the-final-plan.md)). The review screen shows who has not answered, takes place name, address or map URL and a note (280 characters), and freezes time and response set on confirmation.
- The review and confirmed screens write the time on the circle's clock, as the options do, and name the zone when the reader's own device is in a different one ([ADR 0032](decisions/0032-the-circles-zone-is-shown-when-the-readers-device-differs.md)). No screen knows another member's zone, so none says what time it is for them.
- **Replies closed with no decision**: a reminder at the deadline, and one more a day later if an option is still waiting to be locked in; a screen offering **Lock in [top option]**, **Hand this to someone else** (to a member the plan is asking who has a saved place), or **Give it one more day** — a day from now or from the deadline if later, never later than thirty minutes before the last possible start, once per revision, and saying so when there is no day left to give ([ADR 0039](decisions/0039-replies-closed-is-told-per-deadline-and-once-a-day-later.md)).
- Every member sees Going / Can't make it / To confirm from their response and may correct it. On one of the offered options that is as it always was. On a time the organiser set themselves, a member whose times cover it, or who said "I'm easy", is going; everybody else is **to confirm**, never "can't make it", whether they answered or not. The organiser's own status follows their own answer by the same rule. After a move it is derived again from this revision's answers by the same rule, so nobody re-confirms what their answer already said, and a status somebody set by hand for the old time does not carry over. A place or note edit changes nobody's status.
- The confirmed screen generates a paste-ready message and link; web participants get the `.ics`, as one tap on a link to the file that opens the phone's own Add to Calendar where the platform does ([ADR 0063](decisions/0063-the-calendar-file-is-served-at-a-link-with-a-short-lived-signed-token.md)), and as a download elsewhere; app users get native add-to-calendar. (A Google Calendar template link for Android web is held to Slice 3.)
- A locked-in plan has three actions for the organiser. **Edit this plan** changes the time, the place and the note without asking anybody again: a new place or note shows for everyone straight away and emails nobody; a moved time supersedes the old confirmation in the same revision, says who it still works for and who is asked, shows as moved for everyone, tells the plan's members once, and the reminder and the calendar entry follow it. **Ask for new times** (this was "Change the time") reopens availability as a new revision and marks the previous confirmation superseded; members see "Thursday is off the table" and a fresh ask. Editing a plan whose time has ended is not offered. After a hand-off the new organiser has the same freedom.
- **Cancel** takes an optional note, produces a final state, a paste-ready update, and never changes `last_met_at`.

### 5.8 Reminders and communication

#### Push (app members)

New named plan; quiet ask seeking interest (to everyone except the initiator); threshold reached (initiator: "do you want to pick the time?"; keen members: "choose your times"); deadline approaching (non-responders only, 24 hours before; 20 minutes before on a tonight plan, whose replies close within the hour); options ready (organiser); asked again (members whose answers an edit cleared, once per revision; [ADR 0046](decisions/0046-an-edit-that-clears-answers-asks-those-people-again.md)); locked in / moved / changed / off; one reminder two hours before (going members); did it happen (organiser, next morning); about time (one person only, per the nudge policy). Full copy is on the "Push copy" artboard. Push is asked for contextually in the app, only when a first reminder is due, never at onboarding.

#### Organiser email (no app)

The signed-in organiser receives options ready, replies closed with no decision, did it happen, and about-time nudges by email until they install the app. **Every one of these letters carries a link that stops that kind of letter without signing in, and the same address is its `List-Unsubscribe`** ([ADR 0067](decisions/0067-every-cadence-nudge-carries-a-stop-link-and-the-sent-card-says-an-account-is-made.md) for the nudge, [ADR 0069](decisions/0069-every-account-holder-letter-carries-a-stop-link-that-needs-no-sign-in.md) for the rest). Opening the link does nothing: the page says what the tap stops and asks for one tap, so a mail gateway that opens it stops nothing. The tap is safe to repeat, reveals nothing, and writes only the flag the settings screen writes, which settings turns back on. A letter that cannot be given the link is not sent. For the nudge the link is "Stop these reminders" (`/n#<token>`) and it turns off **Nudges to plan the next one** for that person in every circle they are in. For options ready, replies closed and did it happen it is "Stop emails about plans you organise" (`/o#<token>`), which is the person's **Emails about plans you organise** switch on notification settings: one switch for the person, not per circle, and it stops all three, replies closed included ([ADR 0029](decisions/0029-an-organiser-turns-organiser-email-off-in-the-app.md) kept replies closed outside it; [ADR 0069](decisions/0069-every-account-holder-letter-carries-a-stop-link-that-needs-no-sign-in.md) removed that exception, because a stop link has to stop the letter it is under). The footer of each also says where the switch is. The about-time nudge is also stopped by that circle's **Nudges to plan the next one**.

#### Founder's letter to a first plan nobody has answered

A circle's first plan that is still asking, 48 hours after it was made, with no answer from anyone but its organiser, gets **one** letter to the organiser: "Nothing's come in on your {circle} plan yet. If something's in the way, reply to this and I'll help you sort it." It is a support letter under the organiser-letters consent, not product marketing ([ADR 0085](decisions/0085-a-first-plan-nobody-answers-gets-one-question-and-one-letter-from-the-founder.md)). It is sent only while **Emails about plans you organise** is on, through the same dispatcher and quiet hours (9 pm to 8 am) as the organiser's other letters, and carries the same stop link (`/o#<token>`) and `List-Unsubscribe`. It is plain text in the founder's voice, from the founder's first name, with replies to the support address; it names the circle and nothing else, no plan code and nobody's name, and has no button. **Once per circle, ever**: a second stalled plan in the same circle sends nothing, and nothing follows it. It is skipped if, by the time it is due, anyone else has answered, the plan has ended or the plan has been handed to someone else.

#### Quiet-ask initiator email (no app)

The initiator of a quiet ask receives two letters about their own ask, at their own confirmed address, until they install the app: **threshold reached** ("Enough people are keen. Do you want to pick the time?") and **closed without opening** ("Not enough people were free this time"). Each goes to the initiator alone, once; neither names anybody or carries a count; neither is sent for a withdrawn ask. Nobody else is ever emailed about a quiet ask before it opens. Once it has opened, if replies close with nobody in the organiser role, the circle owner's neutral nudge (§5.4) is a replies-closed letter of its own, to their own address ([ADR 0038](decisions/0038-the-quiet-asks-initiator-is-written-to-at-their-own-address.md)). Each carries "Stop emails about quiet asks" (`/q#<token>`) and `List-Unsubscribe` to the same page ([ADR 0069](decisions/0069-every-account-holder-letter-carries-a-stop-link-that-needs-no-sign-in.md)): one tap turns off **Quiet asks** for that person in every circle they are in, which also means they are not asked about other people's and cannot start one until they turn it back on in notification settings; it writes nothing else and is safe to repeat. A letter that cannot be given the link is not sent.

#### Plan-update email (web-only participants)

For a verified subscription to one plan: confirmed; moved, when the organiser moves a locked-in time, once (a place or note edit sends nothing; [ADR 0051](decisions/0051-the-organiser-sets-the-final-plan.md)); time or place materially changed; asked again, when an edit cleared their answer (once per revision, never for a quorum, deadline or required-members change; [ADR 0046](decisions/0046-an-edit-that-clears-answers-asks-those-people-again.md)); cancelled; one reminder two hours before; did it happen. Never anything else. Verification link expires in 24 hours; resend invalidates the previous token; the verification email contains nothing but the link. Every event email carries **Stop emails for this meetup** and **Manage email preferences** links that work without sign-in and a single-use re-entry link. Subjects never include names beyond the circle's and never reveal quiet-ask state. Addresses are never visible to owners, organisers or other members.

**What the screen is told about the address.** `request-email-updates` answers every caller the same, so nobody can walk a list of addresses through a plan and learn which of their friends use the product. The one exception is the address's own confirmed owner (the address asked about is the caller's confirmed sign-in address): their answer also says whether the emails are `live`, `pending` (a link was sent) or `suppressed` (nothing will ever be sent), so the screen never promises email to an address that cannot receive it ([ADR 0055](decisions/0055-after-sending-one-step-keeps-your-place-and-turns-on-the-updates.md)).

#### Existing-chat sharing

Every plan state includes **Share to group chat** with generated text: invite, new plan, waiting ("We're waiting on 4 replies…"), locked in, changed, cancelled. **The one exception is a quiet ask still gathering interest, which has no share action and no generated text**: pasting its link would show the chat who started it, and the people it asks are already members, prompted inside the circle (§5.4, [ADR 0022](decisions/0022-a-plan-link-admits-new-members-while-the-plan-is-asking.md)). Once it opens for times it is shared like any other plan. The invite secret rides in the URL fragment, so chat previews never see it. The app records that the share sheet opened, not whether a message was sent.

#### Rules

No repeated daily reminders; at most one deadline reminder per member per plan; quiet hours 9 pm–8 am local except confirmed, moved and cancelled; every notification deep-links to a decision; delivery is idempotent per recipient, plan revision, kind and occurrence; hard bounces and complaints suppress immediately; nothing about activity, streaks or news, ever.

### 5.9 Cadence and repeat use

- A reported-happened meetup sets `last_met_at`; the next due date follows the cadence.
- Seven days before a monthly or two-monthly due date, or two days before a weekly or fortnightly one, the circle home shows **About time for the next one** and one person is nudged according to the nudge policy: whoever organised last, **take turns** (round-robin among members who attended the last happened meetup and are not muted, passing from whoever organised last to the next in join order; default for circles of four or more), or the owner. The nudged member's card says it is their turn; everyone else's does not name anybody.
- One push or email per cycle (the due date the last meetup sets), sent when the circle home starts showing **About time** and only if no plan is open (asking or locked in); a plan made, a snooze or a meetup before it is sent stops it, and it is not sent again until the circle next meets ([ADR 0036](decisions/0036-the-cadence-nudge-is-decided-once-per-cycle.md)). Someone who has turned **Nudges to plan the next one** off is never asked: under take turns the turn passes on, and under the other two policies nobody is asked. The owner can **Snooze a month** (the due date does not move); any member can **Turn off nudges** for themselves. No guilt or streak framing.
- **Plan another** pre-fills category, duration, quorum, area and a future window from the last happened plan.

### 5.10 Outcome confirmation and lightweight memory

- The morning after a confirmed meetup the organiser is asked **Did this catch-up happen?** — happened, cancelled, moved outside Circles, not sure — with an optional one-line note for the circle's record. Copy says nobody is scored and nobody is told who came.
- Members may tap **I was there** / **I couldn't make it** from circle home or the emailed link.
- **Organiser micro-survey**: on the confirmation review, "Did you have to chase anyone outside the app?" (no / one person / more than one), which is optional and never holds "Lock it in": an unanswered question is stored as not answered, and the founder's analytics counts those separately, never as "no" ([ADR 0061](decisions/0061-the-chasing-survey-never-holds-lock-it-in.md)); on the outcome report, "Did the plan change outside the app?". Two taps each; this is the evidence for H2.
- "Reported happened" = organiser says so; "corroborated happened" = at least one other member confirms attendance.

### 5.11 Guest → saved place → app

This section replaces v1's pricing prompt. The full map is in the [guest → app flow](./guest-to-app-flow.md) and on canvas page 5.

Two conversions, each with its own moments. A prompt appears only after the thing it would have helped with has just happened; it is one tap to dismiss; it shows at most once per moment per plan; after two "not now"s on an app prompt nothing appears for 30 days; nothing appears before an answer, in an email, or on the join and availability screens; installed members never see app prompts.

| Moment | Prompt |
|---|---|
| Times sent | One card: email updates, with a "Save my place" switch on by default; for a signed-in member with a confirmed address, their address as text and one button (ADR 0055) |
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
website "Start a plan" → "Who do you keep meaning to see?": "Sunday Crew" (no account)
→ "Which evenings could you do?": the monthly window, three evenings picked (still no account)
→ "Who's asking?": first name and email → the code, which sets the circle up
→ "Ask Sunday Crew." the message + link, with the organiser's own evenings already in it → shared to the group chat
→ "Over to Sunday Crew." → circle home, finding a time
→ Nina and Tom tap the link, add a name and answer; the quorum follows the circle
→ options arrive as replies come in → confirm Thursday → share "Locked in"
→ next morning: did it happen? → happened → last caught up updates
```

### 6.2 Guest, including a lost session

```text
Taps the link in WhatsApp (in-app browser)
→ Join → name → paints times → Send my times
→ email card → verifies → app prompt dismissed
→ ten days later taps "Locked in" in iMessage (Safari, no session)
→ Continue as Nina → confirmed page → add to calendar
→ "Keep your place for good?" → later
→ morning after: I was there → "another group?" → starts a circle → signs in
```

### 6.3 Quiet ask

```text
Tom (saved place) taps "See if people are keen" → this weekend → stop Friday midday
→ members get the aggregate prompt → Nina, Jess keen → threshold
→ Tom privately chooses "Ask for a volunteer" → Nina taps "I'll pick the time"
→ keen members choose times → Nina confirms → nobody knows Tom asked
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
| 0 First time, organiser | First circle, first plan, save your place, email, code, name, plan shared, availability, sent, circle home |
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
- A plan revision has at most one active confirmation; a confirmed time never changes as a side effect of later responses. The organiser changing it on purpose is not a side effect of a response: a move supersedes the confirmation inside the same revision and writes a new active one, so there is still at most one ([ADR 0051](decisions/0051-the-organiser-sets-the-final-plan.md)). An answer that arrives after lock-in changes nothing.
- Raw device-calendar events never enter the backend.
- Availability is scoped to one plan revision and never reused silently.
- Availability is shown to other members only as counts, and to the editor as each other person's windows day by day with no identity and nothing linking their days; only from the current revision, never the reader's own, and only once one other answer with times is in for the day counts and two for the windows ([ADR 0045](decisions/0045-the-editor-shows-what-others-have-said-as-counts.md), amended by ADR 0066). Nobody's name is ever beside a window of times. The option cards name who can make each option on offer, who cannot and who has not answered, and show no window ([ADR 0066](decisions/0066-the-group-sees-who-can-make-each-option-and-nobody-sees-whole-availability.md)).
- Quiet-ask initiator identity and individual interest answers are never exposed, before or after threshold. That includes by inference from data: a member never reads another member's saved-place state or mute switches ([ADR 0060](decisions/0060-a-quiet-asks-initiator-is-not-inferable-from-member-data.md)).
- A reattachment moves a membership only within a circle the guest already belongs to, and never takes a saved-place member's place. A signed-in account may take a guest's place from the list, as a guest may ([ADR 0088](decisions/0088-a-signed-in-account-can-continue-as-a-guest.md)). (An emailed link taking a place *back* from a saved account whose own email is not the link's address is the one exception: [ADR 0049](decisions/0049-continue-as-resolves-a-code-only-while-it-is-live.md), decision 6.)
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
- An account holder does not want a kind of letter they never opted into (the cadence nudge, the organiser's letters, the quiet ask's two): every one carries a stop link that works without signing in and a `List-Unsubscribe` header to the same page, scoped to that kind of letter and that person, which never stops plan-update email and cannot be used for another kind of letter or another person. A tampered, expired or unknown link gets one answer. Opening the link stops nothing; only the tap does ([ADR 0069](decisions/0069-every-account-holder-letter-carries-a-stop-link-that-needs-no-sign-in.md)).
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
| Organiser entry | `organiser_draft_started` (the first screen) → `organiser_gate_shown` ("Who's asking?") → `organiser_gate_passed` (the code): how many who start a first plan reach the gate, and how many pass it (no payload: [ADR 0053](decisions/0053-the-organiser-gate-moves-to-before-the-share.md), [ADR 0090](decisions/0090-the-first-run-is-four-screens-to-the-share-and-the-organiser-answers-first.md)). `availability_submitted` also fires for the organiser's own answer at the finish; `organiser_source` is asked after the share |
| Circle acquisition | Circles created; source; expected member count. Source is the organiser's answer to "How did you hear about {brand}?" or, for one who arrived on a tagged link, `content`; and for those, the campaign tag of the post, read as the funnel by tag ([ADR 0084](decisions/0084-a-campaign-tag-labels-a-circles-cohort-row-never-a-person.md)) |
| Invitation | Link-preview impressions are unobservable; join-link opens → joins → first response |
| Stalled first plans | A circle's first plan that has stopped, by the week the circle began and the source: made and not shared after 24 hours; shared with no answers after 48; answered but short of the quorum at the deadline. Counts and ages from product tables, named by no circle, plan or person; "shared" is the share sheet opening or, failing that event, anybody having joined or answered, so it is a floor ([ADR 0084](decisions/0084-a-campaign-tag-labels-a-circles-cohort-row-never-a-person.md)) |
| Activation | Circle confirms first meetup within 7 days |
| Response | Members responding; time to first/median/last response; share flexible / more-notice / none-work; organiser chasing survey |
| Continuity | Returns with no session; reattachments; duplicate memberships removed |
| Decision | Plan creation → confirmation; quorum vs unanimity; replies-closed path used; hand-offs |
| Outcome | Confirmed → reported happened → corroborated happened |
| Retention | Second plan and second happened meetup within cadence; nudge policy and who acted |
| Quiet-ask value | Asks by usual/non-usual organisers; threshold rate; organiser accepted by initiator vs volunteer (a server-side aggregate with no user, plan or circle on it, [ADR 0041](decisions/0041-keen-members-may-take-the-role-as-soon-as-it-opens.md)); expiry rate |
| Growth | Nudges shown/dismissed/tapped by moment; accounts claimed by moment; app first opens linked; guests who start a circle within 30 days |
| Calendar value (Slice 3) | Explanation viewed → granted; overlay used; entry time with/without |
| Trust | Calendar denial/revocation, leave, deletion, complaints, unsubscribe, bounce |

### 11.3 Required analytics events

Typed catalogue with a versioned payload schema; at minimum: `account_started`, `account_completed(provider)`, `organiser_draft_started`, `organiser_gate_shown` and `organiser_gate_passed` (each with no payload), `circle_created`, `circle_invite_shared`, `circle_join_opened`, `circle_joined`, `session_missing_on_return`, `member_reattached(source: list|email|list_account)`, `duplicate_member_removed`, `plan_created`, `plan_shared`, `plan_edited`, `plan_expired`, `plan_cancelled`, `plan_rescheduled`, `quiet_ask_created` and `quiet_interest_answered` (recorded against nobody, and no answer), `quiet_threshold_reached` (server-recorded when an ask opens; no user, plan or circle, times to the hour), `organiser_accepted` (no role: [ADR 0041](decisions/0041-keen-members-may-take-the-role-as-soon-as-it-opens.md)), `availability_started(usual_offered)`, `availability_others_read(others_shown)`, `availability_submitted(status, usual_used)`, `candidate_set_generated`, `candidate_viewed(role)`, `candidate_selected`, `deadline_passed_action`, `meetup_confirmed(own_time, below_quorum)`, `meetup_moved`, `confirmation_edited`, `organiser_chased(answer)`, `first_plan_stalled(answer: not_posted|posted_no_replies|wrong_group)` (the organiser's one optional tap on a first plan 48 hours old that nobody else has answered; Skip records nothing; [ADR 0085](decisions/0085-a-first-plan-nobody-answers-gets-one-question-and-one-letter-from-the-founder.md)), `share_opened(kind)`, `calendar_add_opened`, `ics_downloaded`, `email_updates_offered`, `email_submitted`, `email_verified`, `email_subscription_changed`, `organiser_email_changed(enabled)`, `email_delivery_result(code)`, `outcome_reported`, `attendance_confirmed`, `cadence_prompt_sent(recipient_role)`, `plan_another_started`, `app_nudge_shown|dismissed|tapped(moment)`, `account_claimed(moment)`, `organiser_source(source: friend_group|reddit|meetup|other|skipped|content)` (`content` is recorded without asking for an organiser who arrived on a link carrying a campaign tag, `?from=<tag>`; the tag itself is in no event, [ADR 0084](decisions/0084-a-campaign-tag-labels-a-circles-cohort-row-never-a-person.md)), `app_first_open_linked`, `guest_started_circle`, and in Slice 3 `calendar_explanation_viewed`, `calendar_permission_result`, `calendar_overlay_used`, `push_permission_result`. Beside them, `client_error` (SUS-112, SUS-200): a crash on a screen, an uncaught script error, a screen that could not load or a request that failed where the screen stays up (every "We couldn't load…" screen and the sign-in code send show its reference), with a route pattern, an error class from a fixed list, where it was caught, the build, the platform and a reference the person can read out, and no message, stack, address, fragment or plan code.

No names, emails, notes, tokens or event titles in any payload.

### 11.4 Decision gates

Founder cohort (qualitative targets): every test circle confirms at least one real meetup; at least 60% of members respond without one-to-one chasing (survey); median response after link open under two minutes, target under 60 seconds; at least 70% of confirmed meetups reported happened; at least 80% of returns-without-session reattach without owner help; at least one group initiates a second meetup; at least one non-usual organiser starts a plan or quiet ask; at least half of guests who submit an email verify it.

External cohort: at least 50% of activated circles confirm within seven days; at least 30% of successful circles initiate another within cadence; conversions to saved place and app arrive at value moments rather than only at the organiser gate; willingness to pay is then tested with a real transaction.

Which cohort a circle is in is a fact only the founder can see ([ADR 0058](decisions/0058-every-circle-carries-a-cohort-only-the-founder-can-see.md)). A circle is in the founder cohort when its owner is on the founder allowlist at creation and in the external cohort otherwise; the founder can change it. The founder analytics screen counts each cohort's gates over that cohort's circles alone.

## 12. Architecture summary

The implementation is specified in the [technical architecture](./technical-architecture.md). Product-relevant decisions:

- One Expo SDK 57 universal app (iOS, Android, web) with Expo Router; web output in `server` mode on **EAS Hosting Starter** with a custom domain, using one server route for link previews only.
- Supabase (Auth with Apple, Google, email OTP and anonymous sign-in; Postgres with row-level security; Edge Functions; pg_cron), Resend for transactional email, Cloudflare Turnstile on anonymous joins, Expo Push in Slice 3.
- Domain-driven design with seven bounded contexts and a pure, shared domain package containing the candidate engine and state machine.
- No Realtime in Slice 1 (refetch on focus); no Sentry until Slice 3; no marketing-email machinery; no Web Push.
- Data retention: willing windows kept 12 months for members of active circles with a coarse "usual day-parts" summary; other retention as in the architecture §8.5.

## 13. Security and privacy commitments

The architecture holds the controls; the product commitments are:

- Nobody's calendar leaves their phone; friends see who can make each suggested time, never a calendar.
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

- ~~Final product name and domain~~: closed. The product is Wenna (ADR 0043) on `wenna.app` (ADR 0044).
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

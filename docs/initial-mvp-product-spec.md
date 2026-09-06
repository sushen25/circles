# Initial MVP product specification: friend-group meetup coordination

_Status: proposed for validation build_

_Date: 26 August 2026_

_Primary test audience: the founder's 2–3 existing friend groups, followed by non-friend groups_

_Research inputs: [consumer SaaS success research](../consumer-saas-success-research.md) and [meetup market research](../meetup-market-research.md)_

## 1. Executive product decision

Build a mobile-first product for existing friend groups of 3–8 adults, roughly ages 25–40, who live in one city and already want to meet more often.

The product is not a shared calendar and is not another availability poll. It should help a group move through the entire coordination loop:

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

> **Turn “we should catch up” into a confirmed meetup without the scheduling spiral.**

Its broader emotional promise is:

> **Help important relationships actually happen.**

The product must optimise for meetups reported as having happened. Calendar connections, invitations, responses, app opens, and confirmed events are supporting measures—not the outcome.

## 2. What this MVP must validate

The first build is a behavioural experiment, not a small version of the eventual complete product.

### 2.1 Primary hypotheses

| ID | Hypothesis | Evidence the MVP should collect |
|---|---|---|
| H1 | Existing friend groups experience enough coordination friction to adopt a dedicated flow | Groups use the product for a real meetup without the founder operating it for them |
| H2 | A no-install response flow produces adequate group participation | At least 60% of invited members respond without individual chasing |
| H3 | Explicit social availability plus a private calendar overlay is more useful than calendar-free time alone | Users with calendar overlay complete availability faster and report less checking/switching |
| H4 | Quorum-based “best enough” recommendations move groups to a decision faster than waiting for unanimity | Groups confirm a plan even when not every person can attend or respond |
| H5 | Quiet initiation reduces the social risk of always being the person who asks | Members other than the usual organiser use or positively evaluate a quiet spark |
| H6 | A completed meetup creates a recurring reason to return | A meaningful proportion of groups initiate a second meetup within their chosen cadence |
| H7 | The result has potential paid value | After experiencing repeated value, at least one clear payer role and price expectation emerge |
| H8 | A post-response email offer creates a permissioned recontact channel without harming activation | Anonymous participants verify event email; some explicitly opt into product updates; response completion does not decline |

### 2.2 What 2–3 friend groups can and cannot prove

The founder's groups are appropriate for finding broken flows, embarrassing copy, permission anxiety, notification problems, and whether the product helps a real meetup happen. They cannot establish market demand or willingness to pay because the sample is small, socially connected to the founder, and likely to be unusually patient.

Treat the first cohort as a smoke test. If it works, recruit at least 8–10 groups with no close relationship to the founder before interpreting retention or payment signals.

### 2.3 Recommended validation period

Run each circle for 6–8 weeks. A shorter test can validate one-off scheduling, but not whether the product becomes a recurring relationship tool.

## 3. Firm MVP product decisions

| Decision | MVP choice | Reason |
|---|---|---|
| Initial audience | Existing local friend groups only | Keeps positioning and product language specific; couples and community organisers remain later modes |
| Product unit | A persistent private **circle** | Creates recurring context and retention beyond a one-off poll |
| Participation model | Native/mobile app for recurring users; mobile web for no-install participation | Avoids whole-group activation failure while giving retained users a better experience |
| Required account | Circle creator signs in; invitees may participate anonymously on that device | Provides ownership without placing an account wall before value |
| Availability model | Members explicitly mark times they would socialise; an optional device-calendar overlay only removes conflicts | “Calendar-free” is not the same as willing or able to meet |
| Calendar scope | Read selected device calendars locally for the active date window; never upload titles or raw events | Delivers calendar-assisted validation without provider OAuth, background-sync, or privacy complexity |
| Planning modes | Named plan and quiet spark | Tests ordinary coordination and the differentiated social-risk hypothesis |
| Spontaneity | “Tonight” and “This weekend” presets within the same flow | Tests bounded spontaneity without a separate product system |
| Auto-scheduling | Excluded | Explicit confirmation is safer and simpler; auto-scheduling requires established trust and standing rules |
| Decision rule | Quorum plus optional required members; organiser confirms one of the best candidates | Avoids waiting for perfect unanimity while retaining human judgment |
| Chat | Excluded | Existing group chats already win; the product should structure the decision and share back into them |
| Place selection | Optional free-text place or map URL after a time is chosen | Venue recommendation and booking do not test the core scheduling thesis |
| Notifications | Push for app users; optional verified email updates for anonymous web participants; one-tap sharing to the existing group chat | Lets no-install participants stay informed without SMS or forcing registration |
| Email acquisition | Event-email permission and product-marketing permission are separate; marketing is unchecked by default | Builds a permissioned prospect list without repurposing an operational email address or undermining trust |
| Payments | Excluded; include a post-value pricing/fake-door experiment | Keeps delivery focused while collecting an early monetisation signal |
| Public discovery | Excluded | Avoids marketplace cold start, moderation, stranger safety, and a different user job |
| Geography | Globally usable, locally seeded in Melbourne | Time-zone-safe architecture without diluting early recruitment and observation |

## 4. Users and roles

### 4.1 Primary persona: the relationship organiser

This is the person who currently asks when everyone is free, follows up, interprets ambiguous replies, proposes a time, and posts final details. They feel the coordination burden most clearly and are the likely initial adopter or payer.

Their job is:

> “Help me turn the group's desire to meet into a real plan without making me chase and decide everything manually.”

### 4.2 Secondary persona: the willing but passive friend

This person wants to attend but delays checking their calendar, does not want another app, dislikes committing too early, or assumes someone else will organise.

Their job is:

> “Let me give a useful answer quickly without setup, oversharing, or becoming responsible for the whole plan.”

### 4.3 Tertiary persona: the hesitant initiator

This person would like to see the group but avoids asking because they fear rejection, feel they initiate too often, or do not want the visible responsibility.

Their job is:

> “Let me discover whether others also want to meet before I expose myself or take on the organising work.”

### 4.4 Authorisation roles

- **Circle owner:** authenticated creator. Can edit circle settings, rotate the join link, remove members, cancel plans, and transfer ownership later.
- **Member:** an authenticated or device-anonymous identity that has joined a circle. Can respond, initiate plans, and see circle-level plan information.
- **Plan organiser:** the member who created a named plan, or the system-designated organiser after a quiet spark passes its threshold. Can confirm a time, add a place, share reminders, or cancel the plan.
- **Removed member:** loses circle and plan access immediately. Their historic aggregate attendance may remain, but their availability is deleted.

There is no public user directory, follower graph, or contact upload.

## 5. MVP feature set

The following features are required unless explicitly marked as a validation add-on.

### 5.1 Account and first-use experience

#### Purpose

Get the first person from opening the app to sharing a real circle invitation in under three minutes, without asking for calendar access first.

#### Owner sign-in

- Use email one-time code or magic link.
- Do not require a password, phone number, contacts permission, profile biography, or calendar permission during initial onboarding.
- Ask only for display name, time zone confirmation, and optional avatar/emoji.
- Explain the value before asking for notification permission. Ask for push permission immediately after the user creates or joins their first real plan, when the benefit is contextual.

#### Invitee entry

- A circle invite opens a responsive mobile-web route.
- Before any account prompt, show:
  - circle name;
  - inviter's display name;
  - a short privacy statement;
  - expected effort: “Join and answer in about 30 seconds.”
- Tapping **Join circle** creates an anonymous authenticated session tied to that browser/device.
- Ask for a display name. Prevent exact duplicate active names within a circle, but allow the owner to resolve accidental duplicates.
- After the first useful response, show a skippable **Get updates by email** card. This is a notification contact, not registration.
- The card contains:
  - an optional email field labelled **Get updates about this meetup by email**;
  - supporting copy: “We’ll send confirmations, important changes and one meetup reminder. Verify your email to turn this on.”;
  - a separate unchecked checkbox: **Also send me occasional product updates and early-access news. Unsubscribe anytime.**;
  - a **Send verification email** action and a clear **Not now** action.
- Providing an email authorises only the requested plan updates. It does not create an account, subscribe the person to future circle plans, or authorise product marketing.
- If the marketing checkbox is selected, that consent becomes active only after the address is verified. The verification email must contain no promotional copy.
- After the notification choice, separately offer **Save access on every device** through email sign-in. Explain that sign-in is an account feature and is not required to receive updates for this meetup.
- If anonymous browser storage is cleared, access is lost. The owner can remove the abandoned membership and the person can rejoin. This limitation must be acceptable for the validation cohort and clearly documented.

#### Email verification and preferences

- Send a single-use verification link that expires after 24 hours. A resend invalidates the prior unused token.
- Before verification, show **Check your email** and keep the participant’s submitted response intact. Failure to verify must never block meetup participation.
- The verification landing page confirms which permissions became active: **This meetup’s updates** and, only when selected, **Product updates**.
- Every event email contains **Stop emails for this meetup** and **Manage email preferences** links that work without registration.
- Every marketing email contains a prominent one-click unsubscribe. Unsubscribing from marketing must not disable requested event updates, and disabling event updates must not change marketing consent.
- A member may replace their email from the same device; the replacement requires verification and the previous address is unsubscribed from that plan.
- If the participant later creates an account with the same verified address, link the notification contact to the permanent identity and preserve each subscription’s existing scope; account creation never adds marketing consent.
- Do not expose participant email addresses to circle owners, organisers, other members, client-readable database views, logs, or analytics.

#### Acceptance criteria

- A new owner can create and share a circle without connecting a calendar.
- An invitee can join and respond on mobile web without installing the app or entering email/phone details; dismissing the email offer takes one tap.
- An anonymous invitee can verify an email and receive plan updates without creating a permanent account.
- The product-marketing option is separate, unchecked, accurately described, and auditable.
- A user can independently stop event and marketing email without signing in.
- The product never displays an invite wall that depends on recruiting additional people.
- First useful action is reachable with one privacy explanation and no more than three short input screens.

### 5.2 Persistent private circles

#### Purpose

Represent the recurring real-world relationship, store its coordination norms, and make planning the second meetup faster than the first.

#### Circle fields

- Name, such as “Sunday Crew.”
- Emoji or solid-colour icon; image upload is not required.
- Primary IANA time zone, defaulted from the creator's device.
- Desired meetup cadence:
  - weekly;
  - fortnightly;
  - monthly;
  - every two months;
  - no goal.
- Default meeting duration: 60, 90, 120, or 180 minutes; default 120.
- Default quorum, calculated as `max(2, ceil(active members × 0.6))`, editable per plan.
- Optional default area as free text, such as “Melbourne CBD” or “inner north.”
- Active or archived state.

#### Joining and membership

- The owner shares one revocable circle link into an existing group chat.
- Anyone with the current link can request to join. For the private beta, joining may be immediate; the owner can remove an unexpected member and rotate the link.
- The interface shows who has joined, but never exposes one member's availability to another as a raw personal calendar.
- All members can initiate a plan by default. The owner can disable initiation for a specific removed or restricted member only; full role management is outside scope.

#### Circle home

Show only information that advances the relationship:

- active meetup or spark;
- next confirmed meetup;
- date of the last reported meetup;
- cadence state: “On track,” “Time to plan,” or “No goal”;
- members and join-link action;
- **Plan a catch-up** primary action.

Do not include an activity feed, chat, status posts, likes, or generic calendar.

#### Acceptance criteria

- A circle remains usable for multiple meetup attempts.
- The second plan inherits duration, time zone, area, and quorum defaults.
- The owner can revoke the join link without disrupting existing members.
- Archiving a circle stops prompts but preserves confirmed meetup history until deletion.

### 5.3 Named meetup plan

#### Purpose

Give the usual organiser the fastest structured path from an idea to availability collection.

#### Required plan inputs

- Intent/title, with **Catch up** as the default. Optional presets: dinner, drinks, coffee, activity, other.
- Date window:
  - tonight;
  - this weekend;
  - next 7 days;
  - next 14 days;
  - custom, capped at 14 consecutive days in MVP.
- Allowed time-of-day window. Sensible defaults depend on preset:
  - tonight: current time rounded up to the next 30 minutes through 11:30 pm;
  - weekday custom: 5:30 pm–10:30 pm;
  - weekend: 9:00 am–10:30 pm.
- Duration: 60, 90, 120, or 180 minutes.
- Minimum attendees/quorum.
- Required members, optional; the organiser is required by default.
- Response deadline:
  - tonight: one hour or 30 minutes before the plan window ends, whichever comes first;
  - this weekend/next 7 days: 24 hours;
  - next 14 days: 72 hours;
  - editable, but never after the final possible start time.

#### Plan creation result

- The plan becomes visible to all current circle members.
- The creator is marked as organiser.
- A share sheet produces concise copy and a deep link for the existing group chat.
- Registered members receive one push notification. Anonymous members with a verified subscription to that plan receive one email; other web-only members rely on the shared group-chat link.

#### Acceptance criteria

- Creating a plan takes less than 60 seconds when defaults are accepted.
- The organiser can edit the date window, duration, quorum, required members, and deadline until confirmation.
- Any edit that invalidates existing availability clearly asks affected members to reconfirm.

### 5.4 Quiet spark

#### Purpose

Test whether private, threshold-based interest makes initiation feel safer and distributes organising labour.

#### Behaviour

1. A member chooses **See if people are keen** rather than **Plan openly**.
2. They select a broad window: tonight, this weekend, next 7 days, or next 14 days; optional activity category; and an interest expiry.
3. The initiator automatically counts as interested.
4. Other members see: “Someone in Sunday Crew would be up for a catch-up in the next 7 days. Would you?”
5. Responses are **I'm keen**, **Not this time**, or no response.
6. No individual response or initiator identity is revealed while below threshold.
7. The reveal threshold is `min(3, active circle members)`. It is not editable in MVP.
8. Once the threshold is met:
   - the spark moves to availability collection;
   - interested members are included initially;
   - other circle members may opt in later;
   - the system chooses the initiator as organiser by default, but they can pass that role to another interested member;
   - the interface says the plan “started quietly” without naming the initiator unless they choose to reveal themselves.
9. If the threshold is not met by expiry, the spark closes privately. The initiator sees an emotionally neutral result: “Not enough people were available this time.” No list of rejections is shown.

#### Safety boundaries

- Quiet sparks exist only inside a private circle.
- There is no anonymous text, comment, targeting, or public discovery.
- The system records the initiator for abuse handling and auditability.
- Members can mute quiet sparks per circle.
- Maximum one active quiet spark per member per circle and three per circle per seven days.
- In a three-person group, the feature is only socially anonymous, not mathematically impossible to infer. The interface must not promise absolute anonymity.

#### Acceptance criteria

- Nobody can identify individual interest responses through the UI before threshold.
- An expired spark creates no public record naming the initiator.
- The system cannot send a quiet spark to selected members while excluding others; subgroup planning is a later feature.

### 5.5 Availability collection

#### Purpose

Collect the minimum structured information required to find real meetup opportunities, without confusing empty calendar time with willingness to socialise.

#### Core interaction

- Display the active date window as a mobile-friendly day list, not a dense desktop grid.
- The member paints or taps one or more **times I would actually be up for this**.
- Time uses 30-minute boundaries.
- Provide shortcuts:
  - all evening;
  - after work;
  - morning;
  - afternoon;
  - any time that day;
  - none of these dates.
- Show the required duration so a member understands which windows are long enough.
- Allow editing until the plan is confirmed or the deadline passes.
- Provide explicit response outcomes:
  - submitted one or more willing windows;
  - interested, but none of these times work;
  - not this time.

#### Optional device-calendar overlay

- Available only in the installed native app.
- Explain before permission: “Your calendar stays on this device. We use it to grey out conflicts while you choose when you actually want to meet.”
- Let the person select which device calendars to consult.
- Read events only for the plan's active date range.
- Treat events marked free/transparent as non-blocking where the OS data supports it.
- Grey out busy blocks locally, but let the user override them because calendar data can be wrong.
- Upload only the member's final willing windows and an analytics flag that calendar assistance was used. Do not upload event titles, descriptions, locations, attendees, provider identifiers, or the raw busy intervals.
- Calendar access denial leaves the complete manual experience available.
- Provide **Add confirmed meetup** through the operating system's event UI using write-only/no app access where practical.

Expo's current calendar library supports Android and iOS device calendars but requires a development build rather than Expo Go. It can list events for a date range and present system event UI. [Expo Calendar documentation](https://docs.expo.dev/versions/latest/sdk/calendar/)

#### Privacy preview

Before submission, show:

> “Your friends will only contribute to a combined result. They won't see your calendar or a personal schedule view.”

The organiser may see whether each member has responded and which final candidates they can attend, because that is necessary for an informed decision. They do not see unavailable calendar blocks or event details.

#### Acceptance criteria

- Manual completion works identically on native and mobile web.
- Calendar permission is never required to join, respond, or confirm.
- Raw calendar data does not cross the device boundary.
- A user can override a greyed calendar conflict and can revoke permission in OS settings without breaking their account.
- Median availability-entry time and the use of calendar assistance are instrumented.

### 5.6 Candidate generation and explanation

#### Purpose

Turn responses into a small number of defensible, best-enough choices rather than another heat map the organiser must interpret.

#### Definitions

- A member is **available** for a candidate if their submitted willing window fully contains the candidate's duration.
- A member who chose “not this time,” “none work,” or has not responded is unavailable for scoring.
- A candidate is **eligible** when:
  - all required members are available;
  - available-member count meets or exceeds quorum;
  - it starts and ends within the plan's allowed window.

#### Generation algorithm

1. Divide the permitted date/time range into 30-minute start points in the circle's primary time zone.
2. For each start, create a candidate of the chosen duration.
3. Calculate available members, required-member coverage, number of submitted responses represented, and start time.
4. Discard ineligible candidates.
5. Rank remaining candidates by:
   1. highest number of available members;
   2. earlier calendar date;
   3. earlier local start time.
6. Return at most three candidates. Prefer different dates where a lower-ranked date has the same attendee count, so the choices are meaningfully distinct.
7. Store the input revision and scoring version with the result so it can be reproduced.

Do not use an LLM for scheduling. This algorithm must be deterministic, testable, fast, and explainable.

#### Candidate presentation

Each option shows:

- local date, start, end, and time zone if any member differs;
- “5 of 6 can make it”;
- names of those who can attend;
- non-judgmental exception copy such as “Doesn't work for Priya”;
- whether anyone has not responded;
- an explanation such as “Best attendance” or “Same attendance, sooner.”

If no candidate meets quorum:

- show the highest-attendance near matches;
- identify the minimum rule preventing confirmation, such as one required person or quorum of four;
- offer the organiser three explicit actions:
  - lower quorum;
  - adjust the date window;
  - close this attempt.

Never silently lower quorum or remove a required person.

#### Acceptance criteria

- Identical inputs always return identical candidates.
- Candidate changes after a new response are visible and do not silently alter a confirmed meetup.
- DST boundaries, half-hour time zones, and cross-time-zone members are covered by automated tests.
- The organiser never has to interpret a raw overlap heat map to identify the best option.

### 5.7 Decision and confirmation

#### Purpose

Create a clear moment where an actual plan exists.

#### Behaviour

- The plan organiser may confirm any eligible candidate before or after the response deadline.
- If some people have not responded, show a confirmation warning listing them.
- Confirmation requires an explicit tap and review screen.
- The organiser may add:
  - place name;
  - address or map URL;
  - one short note, capped at 280 characters.
- Confirmation freezes the selected time and response set. Later availability edits do not change it.
- Every member sees Going / Can't make it / No response based on submitted availability, and may correct their attendance status after confirmation.
- Generate:
  - a shareable confirmation message and link;
  - an `.ics` download for web participants;
  - a native **Add to calendar** action for app users.
- The organiser can reschedule by reopening availability. This creates a new plan revision and clearly marks the previous confirmation as superseded.
- Cancellation requires an optional reason and creates a final state; it does not delete history.

#### Acceptance criteria

- There is exactly one active confirmation per plan revision.
- All displayed date/time values derive from the same stored UTC timestamps plus IANA time zone.
- Reopening or cancellation produces an update that can be shared to the existing group chat in one tap.
- The system never adds an event to another person's calendar without their action in MVP.

### 5.8 Reminders and communication

#### Purpose

Advance decisions without becoming another noisy social feed. Reach anonymous web participants who explicitly request email updates without forcing app installation or registration.

#### App notifications

Use Expo push notifications for authenticated/installed members. Expo provides one interface over APNs and FCM and its push service is free to use. [Expo push notification overview](https://docs.expo.dev/push-notifications/overview/) and [service guidance](https://docs.expo.dev/guides/using-push-notifications-services/)

Send only:

- a new named plan;
- a quiet spark seeking interest;
- quiet spark threshold reached;
- response deadline approaching, only to non-responders;
- candidates ready for the organiser;
- meetup confirmed, changed, or cancelled;
- meetup reminder, default two hours before;
- post-meetup “Did it happen?” prompt;
- cadence prompt to one designated organiser, not the whole group.

#### Email notifications for anonymous participants

For a verified plan-update subscription, send only:

- meetup confirmed;
- confirmed time or place materially changed;
- meetup cancelled;
- one meetup reminder, default two hours before; and
- the post-meetup “Did it happen?” prompt.

Do not email anonymous participants about unrelated plans, generic engagement, cadence prompts, pricing, feature announcements, or early access unless they separately opted into product marketing. Do not send a deadline reminder after the member has already responded.

Event-update and product-marketing messages use separate templates, consent scopes, suppression state, and analytics. During validation, cap product marketing at two broadcasts per calendar month and send only to verified contacts with an active `product_marketing` subscription.

The `product_marketing` subscription is the permissioned prospect list. It remains server-side and is not visible to circle organisers. The MVP needs a founder-only aggregate count, not an in-app campaign builder or downloadable CSV. If a product update is sent during validation, use an audited, versioned server-side campaign job with a test-send and dry-run step; select active verified subscriptions at send time so recent withdrawals and suppressions are honoured.

#### Existing-chat sharing

Every plan state includes a **Share to group chat** action using the device share sheet. Generate concise state-specific text rather than asking the organiser to compose it.

Examples:

- Invite: “When can Sunday Crew actually catch up? Mark what you'd genuinely be up for—no app needed: [link]”
- Reminder: “We're waiting on 2 replies before picking a time: [link]”
- Confirmation: “Locked in: Sunday Crew, Sat 12 Sep, 6:30–8:30 pm at Hope St Radio. Details: [link]”

The MVP does not integrate directly with WhatsApp, iMessage, Messenger, SMS, or contacts. It records when the user opens the share sheet, not whether the message was sent.

#### Notification rules

- No repeated daily reminders.
- At most one deadline reminder per member per plan.
- Quiet hours default to 9:00 pm–8:00 am in the recipient's local time.
- Push content must not reveal quiet-spark initiator identity or private calendar information.
- Email subjects, previews, and bodies must not reveal quiet-spark initiator identity or private calendar information.
- Every push and event email deep-links to the relevant decision.
- Email delivery is idempotent per recipient, plan revision, event kind, and scheduled occurrence.
- Hard bounces and complaints immediately suppress all non-security email to the address. A soft bounce may be retried with a capped backoff.
- Marketing messages identify the sender and include valid contact and unsubscribe details. Consent and withdrawal records are retained as evidence.

#### Acceptance criteria

- A member can mute a circle or all non-essential notifications.
- Duplicate jobs cannot send duplicate notifications.
- Notification receipts/errors are stored so invalid push tokens can be disabled.
- An unregistered member receives no event email until address verification succeeds.
- Changing, cancelling, or confirming a meetup enqueues the correct email exactly once for each eligible anonymous participant.
- A marketing opt-out is effective immediately in the product and no later than any applicable statutory deadline in downstream systems.

### 5.9 Cadence and repeat use

#### Purpose

Test whether the product can protect a relationship rhythm rather than serve as a one-off poll.

#### Behaviour

- Once a meetup is reported as having happened, set `last_met_at` for the circle.
- Calculate the next cadence due date from the circle setting.
- Seven days before a monthly/two-monthly due date, or two days before a weekly/fortnightly date, show **Time to plan another** to the owner or most recent organiser.
- Send one push at the due date if no new plan exists.
- Never frame the group as failing or use guilt/streak-loss language.
- **Plan another** pre-fills the prior activity category, duration, quorum, area, and an appropriate future date window.
- The circle can snooze the cadence for one interval or disable it.

#### Acceptance criteria

- A completed meetup is not inferred only from the scheduled time passing.
- Cadence prompts stop when a new active plan exists.
- Archived circles never receive cadence jobs.

### 5.10 Outcome confirmation and lightweight memory

#### Purpose

Measure the real-world outcome and give the circle a small sense of progress without building a social feed.

#### Behaviour

- The morning after a confirmed meetup, ask the organiser: **Did this catch-up happen?**
- Responses: happened, cancelled, rescheduled outside the app, not sure.
- If happened, attending members may tap **I was there** from the circle home or shared link.
- Store:
  - organiser report;
  - member attendance confirmations;
  - final participant count;
  - optional one-sentence private circle note.
- Photo albums, reactions, comments, and public memories are excluded.
- A meetup counts as **reported happened** when the organiser says it happened.
- It counts as **corroborated happened** when at least one other member confirms attendance.

#### Acceptance criteria

- The north-star metric can distinguish scheduled, reported-happened, and corroborated-happened meetups.
- A cancelled plan does not update the circle's last-met date.

### 5.11 Validation and pricing prompt

After a circle has two reported-happened meetups, show the owner a non-blocking concept test:

> “Keep this circle on track automatically: smarter recurring suggestions, calendar sync, and automatic reminders.”

Test choices:

- A$5 per month per circle;
- A$50 per year per circle;
- interested, but not at that price;
- not interested.

This is a fake door and must say the feature is not available yet after the tap. Do not collect payment details. Treat responses as weak evidence and follow them with interviews; actual willingness to pay must later be tested with a real checkout.

## 6. End-to-end journeys

### 6.1 First named meetup

```text
Owner signs in
→ creates circle and cadence
→ creates “Catch up in next 14 days”
→ shares one link to existing group chat
→ friends join on mobile web and mark willing windows
→ each friend may verify an email for this meetup’s updates and separately opt into product news
→ app users optionally overlay device calendars
→ organiser sees three ranked options
→ confirms one, adds place, shares result
→ members add it to their calendars
→ organiser reports whether it happened
```

### 6.2 Quiet spontaneous meetup

```text
Member taps “See if people are keen”
→ chooses Tonight
→ circle receives aggregate interest prompt
→ threshold of three is reached
→ interested members mark actual times
→ candidate engine finds a 7:00–9:00 pm window for three
→ organiser confirms and shares place
→ spark expires automatically if threshold/time cannot be reached
```

### 6.3 Second meetup

```text
Circle reaches cadence due date
→ last organiser receives a gentle prompt
→ taps Plan another
→ defaults are pre-filled
→ same circle link and identities are reused
→ group confirms with less setup than the first time
```

## 7. Information architecture and screens

### Native/mobile app

1. Welcome and email sign-in.
2. Circles list.
3. Circle home.
4. Create/edit circle.
5. Choose named plan or quiet spark.
6. Plan setup.
7. Interest response.
8. Availability editor with optional calendar overlay.
9. Response status and ranked candidates.
10. Confirmation review and details.
11. Confirmed meetup.
12. Circle settings, members, privacy, and notifications.
13. Post-meetup outcome prompt.
14. Email verification and no-sign-in preference page.
15. Minimal founder/admin diagnostics behind an allowlist.

### Mobile web

Reuse the same routes and most components for:

- join circle;
- respond to quiet interest;
- mark availability manually;
- view candidates if authorised;
- view confirmation;
- download `.ics`;
- confirm attendance;
- optionally verify an email for plan updates and manage email preferences;
- optionally claim the account by email.

Calendar overlay, push registration, and native calendar insertion are native-only enhancements. The web experience must never appear broken when those capabilities are absent.

## 8. State models and invariants

### 8.1 Plan state machine

```text
draft
├─ named ───────────────→ collecting_availability
└─ quiet → seeking_interest
             ├─ threshold reached → collecting_availability
             └─ expiry reached ───→ expired

collecting_availability
├─ eligible candidates → ready_to_decide
├─ window/deadline edit → collecting_availability (new revision)
├─ closed without result → expired
└─ organiser cancels ───→ cancelled

ready_to_decide
├─ response change ─────→ collecting_availability/recalculate
├─ organiser confirms ──→ confirmed
└─ organiser cancels ───→ cancelled

confirmed
├─ reopen/reschedule ───→ collecting_availability (new revision)
├─ cancel ──────────────→ cancelled
└─ outcome report ──────→ completed
```

### 8.2 Invariants

- Every plan belongs to exactly one circle.
- Only active circle members can see or act on a plan.
- A plan revision has at most one active confirmation.
- A confirmed time never changes as a side effect of later responses.
- Raw device-calendar events never enter the backend.
- Availability is scoped to one plan revision and is not reused silently.
- Event-email permission is scoped to one plan and is never treated as product-marketing permission.
- No notification job may resolve a raw email address in a client or analytics context.
- Quiet-spark identity and individual interest responses are not exposed before threshold.
- All plan times are stored in UTC with the creation/display IANA time zone.
- State transitions are performed server-side and are idempotent.

## 9. Edge cases that must be designed, not deferred

- A person joins twice from different devices: allow owner-assisted merge later; for MVP show duplicate names and let owner remove one.
- Group membership changes during a plan: removed members lose access and are excluded on recalculation; newly joined members may opt into the active plan.
- A required person leaves: plan becomes ineligible until organiser changes required members or cancels.
- Nobody meets quorum: show near matches and explicit resolution actions.
- Everyone meets quorum at many times: show three distinct dates where possible.
- Deadline passes with no decision: organiser receives one prompt; plan remains decidable until the last candidate start passes, then expires.
- A candidate begins in the past: remove it on recalculation.
- User travels across time zones: display in their local time with the circle time zone visible; scoring remains based on absolute instants.
- DST change: use a time-zone-aware date library and automated transition tests.
- Calendar permission is partial, denied, or revoked: return to manual selection without data loss.
- Device calendar contains all-day “free” or birthday events: only block events the OS marks busy where available; allow overrides.
- Invite link leaks: owner rotates it; current memberships stay valid.
- Anonymous member clears browser data: they rejoin; owner removes the abandoned membership.
- Email is mistyped or belongs to someone else: only the non-promotional verification message is sent; no subscription activates and the unverified contact expires.
- Verification occurs after the plan is completed/cancelled: do not activate plan updates or send stale event mail; activate product marketing only if it was separately requested and the verification token is still valid.
- The same verified address is attached to multiple anonymous memberships in one plan: send one copy per plan event and do not reveal the linked memberships.
- A previously bounced, complained, or suppressed address is submitted again: do not reactivate it automatically; show neutral delivery guidance without disclosing suppression history.
- Organiser does not attend after confirming: another member can report attendance, but organiser remains the primary outcome reporter in MVP.
- Plan is organised outside the app after availability was collected: record “rescheduled outside app” rather than falsely treating it as product failure or success.

## 10. Non-functional product requirements

### Performance

- First meaningful web content within 2.5 seconds on a typical 4G mobile connection.
- Availability edits feel immediate and survive refresh after submission.
- Candidate calculation completes within two seconds for 8 members, 14 days, and 30-minute increments.
- All mutation endpoints are idempotent or reject duplicate client request IDs safely.

### Accessibility

- Meet WCAG 2.2 AA for mobile web where practical.
- Do not communicate availability or attendance by colour alone.
- Minimum 44×44-point touch targets.
- Screen-reader labels for date/time controls.
- Support dynamic font sizing without hiding decision actions.
- Use plain, emotionally neutral language for rejection, expiry, and missed cadence.

### Localisation readiness

- Store copy outside components.
- Use locale-aware date/time formatting.
- Store IANA time zones; never rely solely on numeric offsets.
- Launch in English only, but do not hard-code Melbourne, AUD, 12-hour time, or date order into domain logic.

### Reliability

- Every notification and scheduled job has a unique idempotency key.
- State transitions and notification attempts are logged.
- Errors include a correlation ID users can share.
- The system exposes “last updated” where stale state could affect a decision.

## 11. Measurement plan

### 11.1 North-star metric

> **Reported-happened meetups per activated circle per month**, with corroborated meetups shown separately.

### 11.2 Funnel

| Stage | Metric |
|---|---|
| Circle acquisition | Circles created; source; member count expected |
| Invitation | Join-link opens → joins → first response |
| Activation | Circle confirms first meetup within 7 days |
| Response | Members responding; time to first/median/last response; individual chasing reported |
| Decision | Time from plan creation to confirmation; quorum versus unanimity |
| Calendar value | Permission view → grant; overlay used; availability completion time with/without overlay |
| Outcome | Confirmed → reported happened → corroborated happened |
| Retention | Second plan and second happened meetup within intended cadence |
| Quiet-spark value | Sparks created by usual/non-usual organisers; threshold rate; expiry rate |
| Advocacy | Members who create another circle or invite link |
| Trust | Calendar denial/revocation, circle leave, data deletion, complaints |
| Email reach | Email offer → submission → verification; event-email unsubscribe/bounce/complaint rate |
| Permissioned audience | Verified product-marketing opt-ins; opt-in and unsubscribe rate |
| Monetisation signal | Pricing prompt exposure and choice; payer interview findings |

### 11.3 Required analytics events

Use a typed event catalogue with a versioned payload schema. At minimum:

- `account_started`, `account_completed`
- `circle_created`, `circle_invite_shared`, `circle_join_opened`, `circle_joined`
- `plan_created`, `plan_shared`, `plan_edited`, `plan_expired`, `plan_cancelled`
- `quiet_spark_created`, `quiet_interest_answered`, `quiet_threshold_reached`
- `calendar_explanation_viewed`, `calendar_permission_result`, `calendar_overlay_used`
- `availability_started`, `availability_submitted`, `availability_none_work`, `availability_declined`
- `candidate_set_generated`, `candidate_selected`, `meetup_confirmed`
- `reminder_share_opened`, `calendar_add_opened`, `ics_downloaded`
- `email_updates_offered`, `email_submitted`, `email_verification_sent`, `email_verified`
- `email_subscription_changed`, `marketing_opt_in`, `email_delivery_result`, `email_unsubscribed`
- `outcome_reported`, `attendance_confirmed`
- `cadence_prompt_sent`, `plan_another_started`
- `pricing_prompt_viewed`, `pricing_option_selected`

Do not put names, email addresses, event titles, invite tokens, verification/preference tokens, or free-text notes in analytics payloads. `email_delivery_result` may contain only a provider-independent result code such as `delivered`, `soft_bounce`, `hard_bounce`, or `complaint`.

### 11.4 Initial decision gates

For the founder's groups, use these as qualitative targets rather than statistical proof:

- Every test circle confirms at least one real meetup.
- At least 60% of members respond without personal one-to-one chasing.
- Median response completion after link open is under two minutes; target under 60 seconds.
- At least 70% of confirmed meetups are reported as happening.
- At least one group initiates a second meetup through the product within the trial.
- At least one member other than the usual organiser creates a plan or quiet spark.
- Calendar-assisted users describe the overlay as reducing work rather than increasing permission concern.
- At least half of anonymous participants who submit an email complete verification; investigate copy or deliverability if they do not.
- Track product-marketing opt-in as an acquisition signal, but do not optimise it by preselecting or bundling consent.

After the smoke test, keep the market-research gates: at least 50% of newly activated circles confirm within seven days, at least 30% of successful circles initiate another meetup within cadence, and willingness to pay is tested with a real transaction.

## 12. Recommended architecture

### 12.1 Architecture objectives

Prioritise, in order:

1. Speed from empty repository to a testable vertical slice.
2. One codebase and one primary language that coding agents can understand end to end.
3. Near-zero fixed infrastructure cost during private validation.
4. Reproducible local environments and migrations.
5. Strong access controls for private circle and calendar-adjacent data.
6. A clean path to production without premature microservices.

### 12.2 Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Client | Expo SDK 57, React Native, Expo Router, strict TypeScript | One project targets iOS, Android, and web; file-based routes are easy for agents to navigate. Expo explicitly supports universal apps and provides current agent-oriented documentation. [Expo](https://docs.expo.dev/) |
| Web participation | The same Expo Router app using React Native Web; `web.output: single` for the private beta | Avoids a second Next.js application; invite routes are client-rendered and do not need SEO in MVP |
| Native delivery | EAS Development Builds, TestFlight, and Android internal testing | Calendar and push modules require native development builds; managed signing/builds reduce setup |
| Web hosting | EAS Hosting initially | Deploys Expo Router web output and offers preview deployments on the free plan. [EAS Hosting](https://docs.expo.dev/eas/hosting/get-started/) |
| Backend platform | Supabase hosted project | Managed Postgres, Auth, Row Level Security, Realtime if needed, Edge Functions, Cron, Storage, and generated TypeScript types in one service. [Supabase](https://supabase.com/docs) |
| Authentication | Supabase email OTP/magic link for permanent users; anonymous sign-in for web invitees | Supports value before PII and later identity linking. Anonymous auth requires CAPTCHA/rate-limit attention. [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) |
| Business logic | Pure TypeScript domain functions plus a small number of Supabase Edge Functions | Deterministic, shared, testable logic without a long-running API server |
| Data access | Supabase client for authorised reads; server-side functions/RPCs for security-sensitive state transitions | RLS protects circle data; confirmation, invite redemption, quiet threshold, and candidate writes stay authoritative |
| Scheduled work | Supabase Cron invoking idempotent Edge Functions | Handles expiry, deadline reminders, cadence prompts, and outcome prompts without a worker service. [Supabase Cron](https://supabase.com/docs/guides/cron) |
| Push | `expo-notifications` and Expo Push Service | Unified APNs/FCM path, no additional messaging vendor |
| Email | Resend API called only from Supabase Edge Functions | Fast setup, custom-domain authentication, webhooks and a free allowance suitable for the private beta. [Resend pricing](https://resend.com/pricing) |
| Calendar | `expo-calendar`, local processing only | Reads selected device calendars for the active window and presents native calendar UI without provider integrations |
| Product analytics | First-party `analytics_events` table and SQL views for the small beta | Avoids another SDK/vendor and keeps event definitions visible to agents; revisit PostHog after external beta |
| Error monitoring | Structured server logs plus EAS/Expo diagnostics initially | Adequate for 2–3 groups; add Sentry before a broader external beta |
| CI | GitHub Actions for typecheck, lint, tests, migration reset, and build checks | Deterministic feedback for humans and coding agents |

Expo Router is currently a file-based router for Android, iOS, and web, and Expo provides official skills/instructions specifically for Codex and other coding agents. [Expo Router](https://docs.expo.dev/versions/latest/sdk/router/) and [Expo AI-agent guidance](https://docs.expo.dev/agents/)

### 12.3 System shape

```text
                       ┌──────────────────────────────┐
                       │  Expo universal application │
                       │                              │
 Group-chat link ─────▶│  Mobile web guest flow      │
 iOS / Android ───────▶│  Native recurring-user flow │
                       │  Local calendar overlay      │
                       └──────────────┬───────────────┘
                                      │ Supabase JS / HTTPS
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Supabase project                        │
│                                                                 │
│  Auth ──▶ Postgres + RLS ──▶ SQL views / first-party analytics │
│             │         ▲                                        │
│             ▼         │                                        │
│       Edge Functions / atomic RPCs                              │
│       - redeem invite                                           │
│       - transition plan state                                   │
│       - calculate candidates                                    │
│       - confirm/reschedule                                      │
│       - generate ICS                                            │
│       - verify/manage email subscriptions                       │
│       - enqueue/send push and email                             │
│             ▲                                                   │
│             │                                                   │
│       Cron + notification jobs                                  │
└─────────────┬───────────────────────────┬───────────────────────┘
              │                           │
              ▼                           ▼
       Expo Push Service            Resend email API
              │                           │
              ▼                           ▼
          APNs / FCM             Verified email address
```

There is no separate Node server, queue vendor, cache, search engine, analytics SaaS, CMS, map provider, or AI inference service in MVP. Resend is the only additional communication vendor.

### 12.4 Why not a separate web application

A separate Next.js/React web app would give more conventional server rendering and web-specific components, but it doubles routing, styling, validation, authentication, and feature implementation. The invite experience is private and link-driven, so search indexing and rich dynamic link previews are not essential to validation. Use the universal Expo app first. Split the web client only if React Native Web becomes a measurable constraint.

### 12.5 Why Supabase over Firebase for this MVP

The domain is relational: circles have members; plans have revisions, responses, windows, candidates, confirmations, and attendance. Postgres constraints and SQL are a natural fit. RLS provides database-level membership isolation, and SQL views make a tiny beta easy to inspect. Versioned migrations also make schema state legible to coding agents.

Firebase remains viable, but Firestore would require more deliberate denormalisation, security-rule duplication, and custom analytics queries for this relationship-heavy model. A custom Node API plus managed database would give maximum control but add deployment, authentication, worker, and operations decisions before they are useful.

## 13. Agent-friendly repository design

Use a single repository and avoid microservices.

```text
/
├── AGENTS.md                         # project rules, commands, architecture boundaries
├── README.md                         # human setup and product summary
├── app/                              # Expo Router routes only; thin composition
│   ├── (auth)/
│   ├── circles/
│   ├── plans/
│   └── join.tsx
├── src/
│   ├── features/
│   │   ├── auth/
│   │   ├── circles/
│   │   ├── plans/
│   │   ├── availability/
│   │   ├── candidates/
│   │   ├── confirmation/
│   │   ├── email-preferences/
│   │   └── outcomes/
│   ├── components/
│   ├── domain/                       # pure types, rules, scoring, state machines
│   ├── data/                         # Supabase repositories and query keys
│   ├── platform/                     # calendar, push, share sheet adapters
│   ├── analytics/                    # typed event catalogue
│   └── config/
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── seed.sql
│   ├── tests/database/               # pgTAP/RLS tests
│   └── functions/
│       ├── _shared/
│       ├── redeem-invite/
│       ├── request-email-updates/
│       ├── verify-email-contact/
│       ├── manage-email-preferences/
│       ├── email-provider-webhook/
│       ├── transition-plan/
│       ├── recalculate-candidates/
│       ├── confirm-meetup/
│       ├── scheduled-jobs/
│       └── generate-ics/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── docs/
│   ├── decisions/                    # short architecture decision records
│   └── ...
├── scripts/
└── .github/workflows/
```

### Rules for coding agents

- `AGENTS.md` is authoritative for setup, commands, boundaries, and definition of done.
- Product rules live in this spec; changes require an architecture/product decision record.
- Use strict TypeScript and avoid `any` at boundaries.
- Define runtime schemas with Zod for all function requests, database-derived DTOs, deep-link payloads, and analytics events.
- Generate Supabase database types and commit them; never hand-copy table types.
- Keep routes thin. Business decisions must not live in screen components.
- Keep candidate scoring and state-transition validation pure and deterministic.
- No schema edits in the hosted dashboard. Every change is a reviewed migration.
- Seed at least three representative circles, including incomplete responses and a quiet spark.
- Every RLS policy is shipped with a database test in the same change.
- One command should run formatting, linting, type checking, unit tests, database tests, and integration tests.
- Use fixture builders rather than large copied JSON objects.
- Keep files small enough for agents to load and reason about; split by domain responsibility, not arbitrary line count.
- Do not introduce a dependency when a small pure function suffices.

Supabase recommends a local, migration-backed workflow with committed config, migrations, and seed data; its CLI can generate TypeScript types and recreate the database from a known state. [Supabase local workflow](https://supabase.com/docs/guides/local-development/cli-workflows)

## 14. Data model

All IDs use UUIDs. Every mutable table includes `created_at`, `updated_at`, and where relevant `deleted_at`. User-facing times use `timestamptz` plus an IANA zone where the original wall-clock context matters.

### Identity and circle tables

| Table | Important fields | Notes |
|---|---|---|
| `profiles` | `user_id`, `display_name`, `time_zone`, `is_permanent` | One row per Supabase user; anonymous identities are flagged |
| `circles` | `id`, `owner_user_id`, `name`, `emoji`, `time_zone`, `cadence`, `default_duration_minutes`, `default_quorum`, `default_area`, `status`, `last_met_at` | Core persistent relationship unit |
| `circle_members` | `circle_id`, `user_id`, `display_name_snapshot`, `role`, `status`, `joined_at`, `muted_at` | Unique `(circle_id, user_id)`; no contact graph |
| `circle_invites` | `circle_id`, `token_hash`, `created_by`, `expires_at`, `revoked_at`, `max_uses`, `use_count` | Store only hash; group link is rotatable |

### Planning tables

| Table | Important fields | Notes |
|---|---|---|
| `plans` | `id`, `circle_id`, `mode`, `state`, `organiser_user_id`, `initiator_user_id`, `title`, `category`, `time_zone`, `window_start`, `window_end`, `daily_start_local`, `daily_end_local`, `duration_minutes`, `quorum`, `response_deadline`, `quiet_threshold`, `revision`, `scoring_version` | Initiator is protected by API/RLS for quiet plans |
| `plan_required_members` | `plan_id`, `user_id` | Organiser included by default for named plans |
| `plan_interest` | `plan_id`, `user_id`, `response`, `responded_at` | Restricted access; no client list query before quiet threshold |
| `plan_responses` | `plan_id`, `revision`, `user_id`, `status`, `used_calendar_overlay`, `submitted_at` | One current response per member/revision |
| `availability_windows` | `plan_id`, `revision`, `user_id`, `starts_at`, `ends_at` | Explicit willing windows only; no raw busy blocks |
| `candidate_sets` | `plan_id`, `revision`, `input_version`, `scoring_version`, `generated_at` | Reproducibility and stale-result detection |
| `candidates` | `candidate_set_id`, `rank`, `starts_at`, `ends_at`, `available_count`, `available_user_ids`, `explanation_code` | Store top choices only; member IDs protected by circle RLS |
| `meetup_confirmations` | `plan_id`, `revision`, `candidate_id`, `starts_at`, `ends_at`, `place_name`, `place_url`, `note`, `confirmed_by`, `status`, `superseded_at` | One active confirmation per revision |
| `attendance_reports` | `confirmation_id`, `user_id`, `status`, `reported_at` | Organiser outcome and member corroboration |

### Operational tables

| Table | Important fields | Notes |
|---|---|---|
| `push_devices` | `user_id`, `expo_push_token`, `platform`, `enabled`, `last_error_at` | Token unique; disable permanent failures |
| `notification_jobs` | `channel`, `kind`, `user_id`, `email_contact_id`, `plan_id`, `plan_revision`, `scheduled_for`, `idempotency_key`, `status`, `attempt_count` | Destination is resolved server-side; unique idempotency key prevents duplicates |
| `email_contacts` | `user_id`, `email_normalized`, `email_hash`, `verified_at`, `status`, `suppressed_at`, `suppression_reason` | Private schema; address never exposed through the Data API; unique hash supports deduplication |
| `email_subscriptions` | `email_contact_id`, `user_id`, `scope`, `plan_id`, `status`, `consented_at`, `withdrawn_at`, `consent_source`, `consent_text_version`, `privacy_policy_version` | `scope` is `plan_updates` or `product_marketing`; plan required only for plan scope; preserve evidence of consent/withdrawal |
| `email_action_tokens` | `email_contact_id`, `purpose`, `token_hash`, `expires_at`, `used_at` | Store only SHA-256 hashes; verification tokens are single-use and expire after 24 hours |
| `email_delivery_events` | `notification_job_id`, `provider_message_id`, `event_type`, `provider_occurred_at`, `recorded_at` | Private operational record for delivery, bounce and complaint processing |
| `analytics_events` | `event_name`, `schema_version`, `user_id`, `anonymous_id`, `circle_id`, `plan_id`, `properties`, `occurred_at` | No sensitive free text or invite tokens |
| `audit_log` | `actor_user_id`, `action`, `resource_type`, `resource_id`, `metadata`, `occurred_at` | Security-sensitive transitions only |

### Data-retention defaults

- Raw calendar events: never stored.
- Availability windows: delete 30 days after plan completion/cancellation unless needed for an active reschedule; retain only aggregate analytics.
- Revoked/expired invite token hashes: delete after 30 days.
- Notification delivery detail: 30 days.
- Unverified email contacts and expired verification tokens: delete after 7 days.
- Verified plan-only contacts: delete the address 30 days after the plan completes or is cancelled, unless another active permission requires it.
- Product-marketing contacts: retain while consent is active; on withdrawal, remove the usable address from marketing audiences and retain only the minimum suppression and consent record needed to honour/prove the opt-out.
- Email consent/withdrawal evidence: retain for the applicable limitation period, then reassess with legal advice before public launch. Do not use operational event-update consent as marketing consent.
- Audit entries: 12 months during beta, then reassess legally and operationally.
- Deleted account: immediately revoke sessions and membership access; purge direct identifiers and personal availability through a background job within 30 days.

## 15. Backend boundaries and APIs

Prefer a small number of coarse, task-oriented endpoints. Do not create CRUD endpoints for every table.

### Required server functions

| Function | Responsibility |
|---|---|
| `redeem-invite` | Validate hashed capability token, join authenticated/anonymous user to circle, enforce rate/use limits |
| `request-email-updates` | Authorise the member and plan, normalise/deduplicate the address, record requested scopes and consent version, rate-limit sends, and issue a verification email |
| `verify-email-contact` | Consume a single-use token, mark address verified, activate exactly the requested subscriptions, and enqueue any still-relevant current-plan update |
| `manage-email-preferences` | Use an opaque email-action token to show and independently disable plan-update and product-marketing subscriptions without account creation |
| `email-provider-webhook` | Verify the provider signature, deduplicate events, record delivery outcomes, and suppress hard bounces/complaints |
| `create-plan` | Validate membership and plan rules, create named or quiet plan, enqueue relevant notifications |
| `answer-interest` | Record quiet response; atomically test threshold; transition state once; protect identities |
| `submit-availability` | Validate non-overlap/window boundaries, replace member response for current revision, increment input version |
| `recalculate-candidates` | Load current inputs, run pure scoring function, persist top candidate set if input version is still current |
| `confirm-meetup` | Validate organiser, candidate freshness/eligibility, create unique active confirmation, enqueue updates |
| `revise-plan` | Increment revision, supersede confirmation if necessary, invalidate affected responses safely |
| `report-outcome` | Record organiser/member status, update circle cadence only when happened criteria are satisfied |
| `generate-ics` | Authorise circle member and return a standards-compliant calendar file without exposing private tokens |
| `process-scheduled-jobs` | Expire sparks/plans, create due notifications, send push/email, and retry only transient failures |
| `delete-account` | Revoke, anonymise, and enqueue data deletion according to policy |

### Reads

The app can use Supabase's generated client for RLS-protected reads:

- circles visible to current user;
- active circle members;
- plans in visible circles;
- own response/availability;
- candidate explanations appropriate to a member;
- confirmations and outcome state.

Sensitive quiet-interest and initiator fields should not be exposed through general selectable views. Use restricted tables plus security-definer functions with a pinned search path, or server functions returning a safe aggregate. Supabase warns that exposed security-definer functions require careful privilege and `search_path` handling. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 16. Security and privacy architecture

### 16.1 Access-control rules

- Enable RLS on every exposed table.
- Revoke default write grants and grant each operation deliberately.
- A member may select only circles where they have an active membership.
- A member may update only their own profile, interest, response, windows, device tokens, and attendance.
- Only owner/organiser server functions perform circle administration and plan transitions.
- Quiet initiator and individual interest rows are unavailable to ordinary client selects before threshold.
- Analytics events are insert-only from clients through a validated endpoint and not client-readable.
- Email addresses, action tokens, delivery records, and consent evidence live in a private schema reachable only through narrow Edge Functions. Circle owners and ordinary clients cannot select them.
- Service-role keys exist only in Edge Function secrets, never in app bundles or repository files.

Supabase recommends RLS for Data API access and separate policies per operation; its testing guidance specifically supports pgTAP tests for policies and data integrity. [Securing data](https://supabase.com/docs/guides/database/secure-data) and [database testing](https://supabase.com/docs/guides/local-development/testing/overview)

### 16.2 Invite-link security

- Generate at least 256 bits of cryptographically secure randomness.
- Put the secret in the URL fragment where feasible (`/join#token=...`) so it is not sent in normal HTTP requests, server logs, or referrer headers before the client redeems it.
- Store only SHA-256 token hashes.
- Use `Referrer-Policy: no-referrer` on invite pages.
- Rate-limit redemption by IP/session and enable Cloudflare Turnstile for suspicious or repeated anonymous sign-ins.
- Link rotation invalidates the old token immediately.

### 16.3 Calendar boundary

The calendar adapter returns only locally derived busy intervals to the availability screen. The screen produces explicit willing windows. Only willing windows cross into the data layer.

```text
Device event titles/details
        │ never leave adapter
        ▼
Local busy intervals
        │ UI overlay only
        ▼
User-selected willing windows
        │ uploaded
        ▼
Candidate engine
```

This boundary should have a code-level interface and tests that make it difficult for an agent to accidentally serialize raw event objects.

### 16.4 Anonymous-user protections

Supabase anonymous users still receive authenticated JWTs and can later link an identity, but Supabase recommends CAPTCHA because automated sign-ups can consume database space. Add Turnstile to web joins before any public beta, schedule cleanup of abandoned anonymous identities, and use restrictive RLS policies for actions that require a permanent owner. [Supabase anonymous auth](https://supabase.com/docs/guides/auth/auth-anonymous)

### 16.5 Email privacy, consent and abuse controls

- Treat a supplied address as personal data and a notification destination, not proof of identity or a permanent account.
- Require address verification before activating event or marketing subscriptions. The verification message is user-requested and contains no marketing.
- Keep event-update and product-marketing consent specific and independent. The marketing checkbox is never preselected, and event-update consent is never reused to promote the product.
- Record the exact consent-copy version, source screen, privacy-policy version, timestamp and scope. Do not store IP addresses solely as consent evidence during the private beta.
- Use at least 256 bits of random entropy for verification and preference tokens; store only hashes, keep tokens out of analytics/logs, and make verification tokens single-use.
- Rate-limit verification by anonymous user, address hash and IP; return a neutral response to prevent address enumeration.
- Authenticate the sending domain with SPF, DKIM and DMARC. Keep the Resend API key and webhook secret in Edge Function secrets only.
- Verify webhook signatures and deduplicate provider events. Immediately suppress hard bounces and complaints.
- Every email preference action must be possible without creating an account. Product withdrawal takes effect immediately in the app, even if a vendor sync later retries.
- Never sell, share, export to an ad platform, or enrich the email list during MVP validation.

For an Australian launch, ACMA says commercial messages require consent, sender identification/contact details and an easy unsubscribe, with unsubscribe requests honoured within five working days. OAIC guidance also requires a simple way to opt out of direct marketing and treats consent as informed, voluntary, current and specific. EU electronic direct marketing generally requires prior consent under the ePrivacy Directive, subject to national implementation and limited customer exceptions. The MVP therefore uses explicit, separately recorded opt-in as its global baseline. This is product guidance, not a substitute for jurisdiction-specific legal review before a public/global launch. [ACMA Spam Act guidance](https://www.acma.gov.au/avoid-sending-spam), [OAIC APP 7 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-7-app-7-direct-marketing), and [EU ePrivacy Directive, Article 13](https://eur-lex.europa.eu/eli/dir/2002/58/oj?locale=en)

## 17. Cost model

### Private validation

Expected fixed infrastructure cost can be close to zero:

- Supabase Free currently includes a 500 MB Postgres database, 50,000 monthly active users, 500,000 Edge Function invocations, and two million Realtime messages. Free projects pause after one week of inactivity and lack automatic backups. [Supabase pricing](https://supabase.com/pricing)
- Expo/EAS offers limited free builds and updates; EAS Hosting is available on the free plan. [EAS plans](https://docs.expo.dev/billing/plans/) and [EAS Hosting](https://docs.expo.dev/eas/hosting/get-started/)
- Expo Push Service is free.
- Resend Free currently includes 3,000 emails per month with a 100-email daily limit, three custom domains, one webhook endpoint and automatic suppression—ample for 2–3 validation groups. [Resend pricing](https://resend.com/pricing)
- First-party analytics uses the existing database.
- No SMS, mapping, AI inference, or payment vendor is required.

External unavoidable costs may include app-store developer accounts and a domain. Check current programme fees at the time of release.

### Before relying on it for broader production

Move to Supabase Pro, currently starting at US$25 per month, for daily backups, longer logs, more resources, and a non-pausing project. Keep the spend cap enabled. Upgrade email capacity and add dedicated error monitoring only when usage justifies them.

## 18. Delivery plan

Prioritise deployable vertical slices. Each slice should end with something usable, instrumented, and testable on a real phone.

### Slice 0: foundation and clickable flow

- Expo universal project, strict TypeScript, routing, design tokens.
- Supabase local configuration, migrations, seed data, generated types.
- CI commands and `AGENTS.md`.
- Clickable named-plan journey using fixtures.
- Analytics catalogue and test IDs.

**Exit:** an agent can clone, run one setup command, open native/web, and execute the fixture flow.

### Slice 1: manual end-to-end meetup

- Owner email sign-in.
- Circle creation and group invite.
- Anonymous web join.
- Optional event-email capture, address verification, independent product-marketing opt-in, and no-sign-in unsubscribe.
- Named plan setup.
- Manual willing-window input.
- Deterministic candidate generation.
- Organiser confirmation.
- Shareable invite/reminder/confirmation.
- `.ics` generation.
- Outcome report.
- First-party funnel events.

**Exit:** one real friend group can confirm and report a meetup without calendar access or push; an anonymous participant can receive verified email updates without registering.

This is the most important release. Test it before adding native complexity.

### Slice 2: mobile convenience

- EAS development builds/TestFlight/Android internal build.
- Device calendar overlay with selected calendars and local-only processing.
- Native add-to-calendar flow.
- Push token registration and core state notifications.
- Offline/error recovery for availability editing.

**Exit:** compare manual and calendar-assisted response effort in a real plan.

### Slice 3: differentiated relationship loop

- Quiet spark and threshold transition.
- Tonight/this-weekend presets.
- Cadence setting and scheduled prompt.
- **Plan another** defaults.
- Corroborated attendance.
- Pricing fake door after two successes.

**Exit:** test whether a non-usual organiser initiates and whether a circle returns.

### Slice 4: beta hardening

- Invite rotation/removal/deletion flows.
- Turnstile/rate limits.
- RLS and abuse tests.
- Accessibility pass.
- Time-zone/DST matrix.
- Notification idempotency and job retry UI.
- Privacy policy, calendar explanation, in-product data deletion.
- Founder diagnostics and experiment export.

**Exit:** safe enough to recruit non-friend groups.

## 19. Testing strategy

### Unit tests

- Candidate generation, ranking, date diversity, and near matches.
- Plan-state transition guards.
- Quorum formula and quiet threshold.
- IANA time-zone conversion and DST cases.
- Calendar adapter transformation proving only intervals reach the UI boundary.
- Analytics payload validation.
- Notification eligibility and idempotency keys.
- Email eligibility, scope separation, token expiry, suppression and consent-version rules.

### Database tests

- Constraints and unique active confirmation.
- Circle isolation for permanent and anonymous members.
- Owner versus member permissions.
- Removed-member access revocation.
- Quiet initiator/interest confidentiality.
- Invite expiry and rotation.
- Analytics table not readable by clients.
- Account-deletion cascade/anonymisation.
- Email contacts unavailable through client roles; independent plan/marketing unsubscribe; expired-token and retention cleanup.

### Integration tests

- Invite link → anonymous join → submit availability.
- Submit email → verify → receive a plan change once → unsubscribe without registration.
- Marketing not selected → no marketing subscription; marketing selected → active only after verification.
- Provider webhook replay → one stored delivery event and no duplicate suppression work.
- Multiple responses → candidate generation → confirmation.
- Quiet threshold reached exactly once under concurrent responses.
- Plan edit invalidates the correct responses.
- Scheduled job retry sends no duplicate push.
- Scheduled job retry sends no duplicate email.
- `.ics` time and time-zone correctness.

### End-to-end device tests

- iOS current and one prior major version.
- Representative Android device/API levels.
- Mobile Safari and Chrome no-install journey.
- Calendar grant, denial, selected calendars, override, and revocation.
- Deep links from a messaging app.
- Email verification and preference links in mobile Safari and Chrome, including expired-token recovery.
- Dynamic type and screen reader through the response path.

### Definition of done for every feature

- Acceptance criteria pass.
- Loading, empty, error, offline, and permission-denied states are designed.
- Analytics event is emitted and schema-tested.
- Relevant RLS/database test exists.
- Accessibility labels and test IDs exist.
- No sensitive data appears in logs or analytics.
- Documentation and seed scenario are updated.

## 20. Risks and explicit mitigations

| Risk | MVP response |
|---|---|
| Founder friends are overly cooperative | Treat as usability smoke test; recruit independent groups next |
| Universal Expo web feels insufficient | Measure route-specific problems before adding Next.js; components/domain logic can be retained if split later |
| Device-calendar overlay is not passive enough | This is deliberate; validate trust and manual intent first, then consider provider free/busy OAuth |
| Web-only members miss automatic updates | Offer verified plan-specific email after value; retain share-sheet messages for members who skip email |
| Email collection damages trust or creates compliance risk | Separate event and marketing scopes, leave marketing unchecked, verify ownership, retain consent evidence, provide no-sign-in unsubscribe, and obtain legal review before public launch |
| Email capture distracts from response completion | Place the optional offer after the first useful response and make dismissal one tap |
| Email sending is abused or harms deliverability | Rate-limit verification, authenticate the domain, process bounces/complaints and suppress immediately |
| Anonymous sessions create duplicate/lost identities | Accept for tiny beta, expose owner removal, add optional identity claim after value |
| Candidate algorithm encodes unfair defaults | Explain ranking, show attendance names, keep organiser choice, version the algorithm |
| Quiet spark can be inferred | Avoid absolute-anonymity claims, require group-wide prompts and threshold three, exclude anonymous communication |
| Push and Cron introduce duplicates | Persist jobs, unique idempotency keys, retry only transient failures |
| Calendar permission undermines trust | Contextual explanation, local-only architecture, manual parity, no permission during onboarding |
| Agents introduce architectural drift | Authoritative spec/ADRs, thin routes, strict schemas, migrations, RLS tests, one CI command |

## 21. Explicitly excluded from the initial MVP

- Couples-specific onboarding or relationship content.
- Community organiser roles, public events, ticketing, waitlists, or moderation.
- Contact upload and friend discovery.
- Direct WhatsApp, iMessage, Messenger, or SMS integration.
- Full group chat or event comments.
- Google Calendar, Microsoft Graph, or iCloud server-side OAuth/sync.
- Background passive monitoring of everyone's calendars.
- Automatic event confirmation or automatic calendar writes.
- Venue recommendations, maps search, reservations, payments, split bills, or transport.
- Public profiles, feeds, likes, follower counts, or event discovery.
- Photo albums and memory feeds.
- AI chat, AI venue generation, or LLM scheduling.
- Subscription billing.
- Desktop-optimised calendar administration.
- Claims to prevent or treat loneliness.

## 22. Post-MVP decision tree

### If groups respond and meet, but do not return

The one-off coordination job is valid, but the relationship-cadence product is not yet proven. Test better cadence triggers, additional circles, or an organiser/event payment model before subscriptions.

### If groups do not respond without chasing

The bottleneck is motivation or channel reach, not time calculation. Explore communication-channel integration, stronger deadlines, delegation, or a different organiser-led segment. Do not add more calendar sophistication first.

### If manual selection works and calendar overlay adds little

Do not build provider OAuth. Keep manual availability excellent and focus on social initiation, decision, and follow-through.

### If calendar overlay materially improves completion

Next evaluate direct Google `freebusy` integration, then Microsoft, with narrow scopes and explicit sync state. Do not store event content. Apple device calendars can remain a local adapter until there is evidence that persistent server-side availability is essential.

### If quiet sparks are used by non-organisers

Develop bounded spontaneity and configurable threshold rules. Test provisional holds before any auto-confirmation.

### If only the usual organiser uses quiet sparks

The anonymity feature may not redistribute labour. Simplify it or replace it with rotating organiser prompts rather than preserving it as a novelty.

### If friend groups love it but will not pay

Test community organisers, hobby groups, and circle-supporter annual plans. Do not degrade trust through calendar-data advertising.

## 23. Final build recommendation

Start with Slice 1 and put it in one real group chat as quickly as possible. The highest-risk question is not whether agents can build calendar integrations. It is whether a lightweight, no-install, quorum-based flow changes a group's behaviour enough to produce a real meetup with less chasing.

Only after that succeeds should the project add the native calendar overlay, push notifications, quiet sparks, and cadence automation. This order preserves the consumer SaaS priorities established in the research:

1. Produce a valuable, recognisable outcome quickly.
2. Remove activation friction for every invited participant.
3. Measure the real recurring behaviour.
4. Earn permission and complexity only after value.
5. Build trust into the architecture.

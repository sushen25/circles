# Market research: a social coordination app for real-world meetups

_Exploratory research, 26 August 2026_

## Executive conclusion

The problem is real, frequent, and emotionally important. The market is also crowded.

The opportunity is **not** a generic shared calendar or another Doodle-style availability poll. Howbout, TimeTree, Partiful, Cupla, Doodle, When2meet, Apple, Google, and a long tail of startups already cover large parts of those workflows. Howbout alone reported four million users and 50 million events by September 2024; TimeTree now describes itself as used by 75 million people; and Partiful has reached millions of monthly active users. These are strong signals of demand, but they raise the bar for differentiation.

The most promising wedge is:

> **A private relationship-coordination layer for busy existing groups that passively finds “socially viable” moments—not merely empty calendar slots—and converts mutual intent into a confirmed meetup with almost no organising labour.**

The product should optimise for meetups that actually happen, not calendars connected, polls completed, or events created.

The clearest unmet needs found in reviews and community discussions are:

1. **No-install participation.** Invitees should be able to respond from a link before creating an account or connecting a calendar.
2. **Passive, privacy-preserving availability.** Share free/busy or chosen “social windows,” never event details by default.
3. **Intent and capacity, not just time.** A blank calendar slot may be protected downtime, too short, too far away, too expensive, or emotionally unrealistic.
4. **Best-enough scheduling.** Waiting for every person and every response causes plans to die. Optimise for a quorum and make trade-offs legible.
5. **A response and decision engine.** The hard part is often the final non-responder or nobody wanting to make the decision—not calculating overlap.
6. **Safe spontaneity.** Reveal mutual, time-bounded interest only after a threshold is reached, so nobody has to risk a visible rejection.
7. **Shared organising labour.** Let any member initiate privately or publicly, rotate responsibility, and avoid making one person the group's unpaid coordinator.

The idea is worth validating, but only with a narrow first audience. The recommended initial segment is **existing friend groups of roughly 3–8 people, ages approximately 25–40, in one metro area, whose members use mixed calendar systems and already try to meet at least monthly**. This group has a sharper pain than students, more complexity than couples, and is less directly owned by Howbout's under-25 base. Couples are an attractive later mode, but Cupla has a strong specialised proposition and a naturally easier two-person scheduling problem. Community organisers are monetisable, but their workflow is closer to Partiful, Luma, Meetup, and Doodle and can pull the product away from intimate relationship outcomes.

The biggest business risk is not technical feasibility. It is whether coordinating friend meetups creates enough recurring value for a consumer subscription. The product must therefore become the recurring system that protects important relationships, rather than a tool opened only for an occasional poll.

## 1. The problem and why it matters

### 1.1 Social disconnection is a large, persistent problem

The World Health Organization's 2025 Commission on Social Connection reported that roughly one in six people globally experience loneliness and called social connection a public-health priority. The report does not prove that scheduling software reduces loneliness, but it validates the importance of the outcome. [WHO Commission on Social Connection](https://www.who.int/publications/i/item/978240112360)

Australia is a credible launch market for the problem:

- In 2024, 15% of Australians aged 15 and over were estimated to be experiencing loneliness and 15% social isolation; loneliness was highest among people aged 35–44 at 17%. [Australian Institute of Health and Welfare](https://www.aihw.gov.au/mental-health/topic-areas/health-wellbeing/social-isolation-and-loneliness)
- Around 40% of Australians reported experiencing loneliness at least some of the time in the previous week in April 2025, using a different survey measure. [Australia's Welfare 2025](https://www.aihw.gov.au/getmedia/4b343cfa-5612-4fbc-8803-97e98dc3caba/aihw-aus-253.pdf?inline=true)
- Parents have substantially less free time than non-parents, which suggests that scheduling complexity becomes especially acute in the life stages where friendships often receive less attention. [Australian Bureau of Statistics time-use data](https://www.abs.gov.au/statistics/people/people-and-communities/how-australians-use-their-time/2024)

These figures describe the social need, not the serviceable market. Loneliness can result from relationship quality, geography, health, income, lack of relationships, and many other factors that a calendar product cannot solve. The app's credible claim should be modest: **reduce the coordination friction that prevents willing people with existing relationships from spending time together**.

### 1.2 The current job is larger than “find a free time”

A successful meetup requires a chain of jobs:

```text
Remember the relationship
→ express interest without social risk
→ identify feasible people/times
→ get responses
→ choose a good-enough time and place
→ commit
→ remember and attend
→ create a reason to do it again
```

Most existing tools own only one or two links in this chain. Polls calculate overlap. Shared calendars expose schedules. Invitation products manage an event after a host has decided to create it. Group chats carry the conversation but not structured decisions. The opportunity is in reducing failure across the whole chain while remaining much lighter than a social network.

An academic field study of 503 users and 322 group invitations found that time and place selection is a group decision, that host preferences matter, and that mobility affects attendance. More than 70% of final time and location choices in the study had majority support. This supports designing for host-guided consensus rather than requiring perfect unanimity. The study is older and partly incentive-driven, so it should inform hypotheses rather than serve as market proof. [OutWithFriendz study](https://arxiv.org/abs/1710.02609)

## 2. Market evidence and category shape

There is no clean public category called “consumer social coordination,” so a precise top-down TAM would create false certainty. Better evidence comes from adjacent product adoption and bottom-up usage.

### Demand signals

- **Howbout** reported four million users across more than 100 countries, 50 million total events, and about two million events added per week when it announced an $8 million Series A in 2024. It also said that more than 75% of users shared their full calendar with at least one friend, although most users were 25 or younger. [Howbout announcement](https://howbout.app/blog/howbout-moments/we-raised-8m-in-funding-led-by-goodwater-/) and [TechCrunch](https://techcrunch.com/2024/09/13/howbout-raises-8m-from-goodwater-to-build-a-calendar-that-you-can-share-with-your-friends/)
- **TimeTree** says it is used by 75 million people worldwide. It had already passed 50 million registered users in 2023, demonstrating broad demand for calendar sharing across families, couples, friends, and groups. [TimeTree App Store listing](https://apps.apple.com/us/app/timetree-shared-calendar/id952578473) and [TimeTree newsroom](https://timetreeapp.com/intl/en/newsroom/2024-01-30/mirai-dsp-poc2)
- **Partiful** said monthly active users were in the millions by the end of 2023. Third-party app analytics cited by TechCrunch estimated about 1.08 million downloads during most of 2024, heavily concentrated in the United States and on iOS. [TechCrunch](https://techcrunch.com/2024/11/18/partiful-is-googles-best-app-of-2024/)
- **Cupla** says it is trusted by more than 500,000 couples, showing that relationship-specific positioning can turn generic calendar capability into a meaningful consumer product. [Cupla](https://cupla.app/shared-calendar-app-for-couples/)
- A continuing stream of small products—Hangs, Sha, Flare, SoKal, Sponta, Frae, MyOwnEvents, Purposely Social, CatchUpify, and others—target spontaneous plans, shared availability, or group scheduling. This is evidence of perceived opportunity, but also of low feature-level defensibility.

### Market interpretation

The category has three characteristics:

1. **The user need is validated.** Large products have achieved meaningful adoption.
2. **Feature supply is abundant.** Calendar sync, polls, RSVPs, event chat, availability, and spontaneous status are already available in different combinations.
3. **No single behaviour is the stable default across all social groups.** WhatsApp/iMessage plus native calendars remain the real incumbent because they are already installed and every group member is reachable there.

This makes the market attractive for a sharply positioned wedge, but unattractive for an undifferentiated “Howbout with random meetups.”

## 3. Competitive landscape

### 3.1 Direct and adjacent competitors

| Product / substitute | Primary job | Strength | Important limitation or opening |
|---|---|---|---|
| **Howbout** | Shared social calendar and group planning | Strong brand with young friend groups; availability, calendar sharing, groups, chat, polls, memories, external sync | Already very close to the proposed concept; forced invitation onboarding and reliability complaints create friction; strongest among users 25 and under |
| **TimeTree** | Shared calendars for families, couples, friends, work | Massive installed base, cross-platform, multiple calendars, comments/photos, freemium | General-purpose calendar rather than active meetup conversion; notification noise and sync/reliability complexity |
| **Cupla** | Shared life and quality time for couples | Clear relationship-specific positioning, two-way calendar sync, privacy controls, one subscription per couple | Only supports a two-person unit; review complaints include slow/inconsistent sync, limited free calendar window, and missing desktop/iPad depth |
| **Partiful** | Invitations, RSVPs, excitement, and event hosting | Excellent no-install guest flow, playful brand, reminders, comments, photos, reusable audiences; now supports date polling | Primarily begins when someone decides to host; weak on passive availability and ongoing small-group relationship maintenance |
| **Apple Invites** | Beautiful event invitations inside the Apple ecosystem | Bundled trust, Maps/Weather/Photos/Music, anyone can RSVP on the web | Host must have iCloud+; event-first rather than relationship-first; cross-platform participation is possible but creation is Apple-led |
| **Doodle** | Group availability polls and business scheduling | Familiar, simple mental model, large groups, calendar integration | Business-oriented, ad/paywall frustration in free tier, and its mobile apps were paused in August 2026 |
| **When2meet / LettuceMeet / Frae** | One-off group availability grid | Fast, free or low-cost, link sharing, often no account | Manual entry, poor mobile experience in older tools, weak follow-through after overlap is found, no persistent relationship context |
| **Google Calendar** | Personal calendar and shared availability | Free, ubiquitous, strong source of truth; can compare up to 50 shared calendars | Works best when calendars are shared within the same ecosystem; not designed for mixed consumer friend groups or social intent. [Google help](https://support.google.com/calendar/answer/6294878?hl=EN) |
| **Hangs / Flare / Sponta and similar startups** | Fast or spontaneous friend plans | Directly target “who is free now?” and casual meetups | Small networks and cold-start risk; many require app installation; features are easy to copy |
| **WhatsApp / iMessage / Messenger** | Conversation and informal planning | Everyone is already present; socially natural; zero new trust request | Decisions become buried, responses are ambiguous, no calendar understanding, one person chases the group |
| **Non-consumption** | Tolerate not meeting | Requires no setup or vulnerability | This is the largest competitor: the pain is meaningful but rarely urgent at the moment a new app must be installed |

### 3.2 Competitive movement matters

Competitors are converging:

- Partiful now supports polling guests before setting a final date, auto-adds events to major calendars, and lets invitees respond without an app. [Partiful App Store listing](https://apps.apple.com/us/app/partiful-party-invite-maker/id1662982304)
- Howbout now directly syncs Google Calendar and combines shared availability, groups, chat, polls, bucket lists, memories, and premium personalisation. [Howbout](https://howbout.app/about)
- Cupla now positions an assistant over calendar, tasks, wishlists, and key dates that can find time and plan dates. [Cupla features](https://cupla.app/the-app/)
- Apple has bundled event invitations into iCloud+, with web RSVP for non-Apple guests. [Apple announcement](https://www.apple.com/newsroom/2025/02/introducing-apple-invites-a-new-app-that-brings-people-together/)

The moat therefore cannot be “calendar sync + polls + AI suggestions.” The initial wedge must produce a meaningfully better outcome for a specific relationship context, then compound through group history, preferences, trust, and distribution.

## 4. Competitor review mining

### 4.1 Method and limitations

This review analysis used current Apple App Store and Google Play listings, official help/bug pages, Trustpilot, and qualitative discussions about Doodle, When2meet, LettuceMeet, Howbout, TimeTree, Partiful, Cupla, and emerging alternatives. It focused on repeated jobs and failure modes rather than isolated feature requests.

App-store review samples are ranked and region-dependent, review aggregators can duplicate or algorithmically summarise reviews, and community posts over-represent builders and dissatisfied users. The themes below are directional hypotheses for interviews and prototype tests—not statistically representative incidence rates.

### 4.2 What users value

| Theme | Evidence | Product implication |
|---|---|---|
| **Seeing multiple people's schedules reduces coordination effort** | Howbout users praise colour-coded friend calendars; TimeTree and Cupla users describe reduced double booking and fewer “what do you have on?” conversations. [Howbout reviews](https://apps.apple.com/au/app/howbout-shared-calendar/id1477248221?platform=iphone&see-all=reviews), [TimeTree reviews](https://apps.apple.com/us/app/timetree-shared-calendar/id952578473?platform=iphone&see-all=reviews), [Cupla reviews](https://apps.apple.com/us/app/cupla-couples-shared-calendar/id1557764033?platform=ipad&see-all=reviews) | Availability should update automatically, but event detail sharing should be optional. |
| **Playfulness builds anticipation** | Howbout users like GIFs, colours, widgets, and memories; Partiful users praise its invitations, comments, photo sharing, and the energy around an event. [Partiful reviews](https://apps.apple.com/us/app/partiful-party-invite-maker/id1662982304?see-all=reviews) | The experience should feel relational and warm after the hard scheduling work, not like enterprise software. |
| **No-install guest flows are unusually valuable** | Partiful reviewers explicitly praise inviting multigenerational groups without requiring the app; Apple and Doodle also allow link participation. | Treat install/account creation as an earned conversion after value, not an entry fee. |
| **Automation reduces the organiser's mental load** | Reviews praise reminders, text blasts, merged calendars, and not having to copy details across group chats. Howbout explicitly pitches not being the group's “unpaid PA.” [Howbout](https://howbout.app/about) | The primary value proposition is labour removed and meetups completed, not calendar visualisation. |
| **Relationship-specific framing improves perceived value** | Cupla reviews and its own user study connect shared scheduling to protected quality time and reduced friction. In its 2023 sample, 75% created at least one shared event per month, while users who created 2–3 per month were more likely to report reduced barriers to quality time. This is company-produced observational evidence, not causal proof. [Cupla study](https://cupla.app/wp-content/uploads/2024/06/Relationship-Survey-2023.pdf) | Retention is more plausible when the app helps protect a relationship cadence, not only create isolated events. |

### 4.3 Repeated complaints and the gaps they expose

#### A. Forced activation before value

Howbout reviewers repeatedly complain that the app is locked until a friend accepts an invitation, including the paradox that the last person in a group may have nobody new to invite. Users also dislike being unable to preview the experience first. [Howbout Australian reviews](https://apps.apple.com/au/app/howbout-shared-calendar/id1477248221?platform=iphone&see-all=reviews)

**Gap:** produce a useful first result for the organiser immediately, let invitees answer through a private web link, and ask them to install/connect calendars only after they have experienced a confirmed plan.

#### B. Calendar reliability is table stakes and still frequently weak

Howbout reviews mention slowness, glitches, and incorrect notifications. Cupla reviewers mention calendar refreshes that require opening Apple Calendar and inconsistent sync. TimeTree's current bug log contains issues involving missing external events, delays, duplicate notifications, freezing, incorrect dates, and disappearing events across platforms. [TimeTree bug log](https://support.timetreeapp.com/hc/en-us/articles/360000329822-Bug-Report)

**Gap:** reliability and transparent sync state can be a differentiator. Show when each calendar last refreshed, never silently assume a calendar is complete, support multiple sub-calendars, and provide a manual fallback.

#### C. Existing polls find overlap but create work

When2meet users describe opening their calendar in one tab and manually painting availability in another, awkward mobile use, and losing the link in a group chat. Users looking for alternatives repeatedly ask for calendar overlays, better mobile entry, flexible time ranges, timezone reliability, and one-click creation of the final event. [Example discussion](https://www.reddit.com/r/UCDavis/comments/1b6nrly/extremely_frustrated_with_when2meet_my_friends/) and [LettuceMeet/When2meet discussion](https://www.reddit.com/r/opensource/comments/1dlol7r/i_made_a_better_when2meet/)

**Gap:** pre-fill availability from calendars, make corrections faster than filling a grid, keep the persistent group in one place, and complete the workflow by confirming the result and writing it back to everyone's calendar.

#### D. The non-responder, not the algorithm, blocks the plan

Community discussions about group scheduling repeatedly observe that friends still have to open the link and respond. Larger groups stall when one or two people remain silent, while the organiser chases them. [Example discussion](https://www.reddit.com/r/indiehackers/comments/1uocw8i/built_a_tool_to_kill_the_whens_everyone_free/)

**Gap:** design explicitly for incomplete participation:

- State a soft response deadline.
- Send private, well-timed reminders.
- Allow “assume unavailable if I do not answer.”
- Surface the best slot for 5/6 rather than showing no perfect result.
- Let the group set required versus optional members.
- Make the cost of waiting visible: “Thursday works for five people; waiting for Alex may lose the hold.”

#### E. Empty time is not the same as willingness

Users express reluctance to connect a whole calendar, while social plans also depend on energy, notice, travel, budget, childcare, and whether a person actually wants to use an empty slot. Howbout itself has multiple privacy states, and Cupla emphasises showing busy time without event details. [Howbout privacy explanation](https://web-dev.howbout.app/get-help/who-see-calendar/) and [Cupla](https://cupla.app/shared-calendar-app-for-couples/)

**Gap:** model two distinct layers:

1. **Feasibility:** calendar free/busy.
2. **Social availability:** willing windows and preferences such as “weeknights with 24 hours' notice,” “local and under $30,” or “spontaneous tonight.”

Only the intersection should create suggestions.

#### F. Notifications can become relationship spam

TimeTree reviews complain about excessive notifications and multiple tabs to clear. Partiful reviews describe losing invitations in notification-only workflows and wanting a way to revisit an undecided invitation. [TimeTree reviews](https://apps.apple.com/us/app/timetree-shared-calendar/id952578473?platform=iphone&see-all=reviews) and [Partiful reviews](https://apps.apple.com/us/app/partiful-party-invite-maker/id1662982304?see-all=reviews)

**Gap:** notifications should represent decisions and mutual opportunities, not activity. Provide a calm inbox, digest controls, “decide later,” and reliable resurfacing.

#### G. Pricing is resented when core coordination is held hostage

Cupla has reviews objecting to paying to see more of a partner's calendar. Doodle users complain that the free experience is heavily ad-supported or too restricted to prove value. [Cupla Canadian reviews](https://apps.apple.com/ca/app/cupla-couples-shared-calendar/id1557764033?platform=iphone&see-all=reviews) and [Doodle reviews](https://au.trustpilot.com/review/www.doodle.com)

**Gap:** core group participation and a basic confirmed meetup should remain free. Charge the person receiving ongoing automation or the organiser managing repeated groups—not every invited member.

#### H. Group identity and boundaries matter

Partiful reviewers ask for reusable subgroups rather than sorting a long list of everyone they have ever attended an event with. Howbout's groups are a strong part of its product. [Partiful reviews](https://apps.apple.com/us/app/partiful-party-invite-maker/id1662982304?see-all=reviews)

**Gap:** persistent private circles with their own cadence, norms, privacy, preferred locations, budget, and history are more valuable than a flat contact graph.

## 5. The whitespace

### 5.1 The strongest product thesis

The most defensible version is not “see when friends are free.” It is:

> **Help a group maintain the relationship cadence it already wants, with the least possible social and logistical effort.**

That implies a product centred on recurring circles rather than a universal calendar:

- A person creates a private circle and chooses a loose goal such as “see each other about monthly.”
- Members can connect free/busy calendars, declare recurring social windows, or answer lightweight link prompts without installing.
- Anyone can send a named or private “spark” such as “up for dinner in the next two weeks.” Private interest is revealed only if enough members opt in.
- The product suggests two or three viable moments based on free/busy, social windows, travel, notice, and the group's past behaviour.
- The group confirms a best-enough option; the system handles reminders and calendar writes.
- After the meetup, the app quietly records that the circle connected, optionally collects a memory, and determines when another suggestion would be welcome.

This transforms the retention loop from occasional event creation into relationship maintenance:

```text
Relationship cadence / mutual spark
→ viable suggestion
→ low-risk responses
→ confirmed meetup
→ real-world reward and shared history
→ next appropriate suggestion
```

### 5.2 What “random” should mean

Truly random scheduling is likely to feel intrusive and disregard real-life constraints. A better interpretation is **bounded serendipity**:

- Members explicitly opt into spontaneous mode for a time window.
- The system reveals interest only after a threshold, such as three people.
- It suggests, but never auto-commits, unless every member has separately enabled a narrowly defined auto-book rule.
- Exact location and calendar details remain hidden.
- The group can set quiet hours, frequency caps, radius, minimum notice, budget, duration, and activity types.
- The message feels socially safe: “Three people in Sunday Crew are open to something nearby after 6” rather than identifying the first person who risked asking.

Anonymous initiation can lower vulnerability, but it introduces risks: exclusion, ambiguity, harassment, and inability to understand who genuinely wants the plan. Use **threshold anonymity**, not anonymous chat. Record initiators for safety internally, reveal only aggregate interest, and let groups disable the feature.

### 5.3 Differentiation wedge and possible moat

**Wedge for the first 1,000 users**

- Busy post-university friend groups rather than all relationships.
- Passive “best time in the next 14 days” suggestions.
- Web participation for friends who will not install.
- Mutual/private sparks that remove the fear of being rejected or always initiating.
- A privacy promise based on free/busy and user-declared windows, not social-calendar surveillance.

**Potential moat if the wedge works**

- Group-specific preference and attendance history that improves suggestions.
- A trusted graph of real, recurring circles rather than public followers.
- Learned coordination policies: who is required, typical duration, notice, locations, quorum, response patterns, and preferred cadence.
- Brand ownership of “protect your friendships” rather than generic scheduling.
- Invitation-led distribution where each successful organiser exposes several relevant users to the product.

None of these is a moat on day one. The product must earn group data through completed meetups and trust.

## 6. Segment evaluation

| Segment | Pain | Frequency / retention | Willingness to pay | Competitive intensity | Recommendation |
|---|---:|---:|---:|---:|---|
| Couples with different work/shift schedules | High | High | Medium | High: Cupla, TimeTree, native shared calendars | Strong later mode; not the first wedge unless founder insight is unusually strong |
| Friend groups aged 18–24 | Medium | High | Low | Very high: Howbout and Partiful have strong brands | Avoid as the initial paid wedge |
| Friend groups aged 25–40 in one city | High | Monthly or better | Low–medium individually | Fragmented; Howbout less concentrated here | **Recommended first segment** |
| Parents maintaining friendships | High | Monthly / quarterly | Medium | Few direct products, but availability is highly constrained | Promising sub-segment after initial learning |
| Shift workers and healthcare/hospitality friend groups | Very high | High | Medium | Shared calendars exist but social coordination is underserved | Strong behavioural niche and possible acquisition community |
| Hobby groups / sports teams | High | Weekly | Medium | Team and community tools compete | Attractive if the product supports recurring attendance and quorum |
| Community organisers / clubs | High | Weekly / monthly | Medium–high | Partiful, Meetup, Luma, Doodle, Eventbrite | Monetisable expansion, but different emotional job and product complexity |
| Distributed / long-distance friends | Emotional pain high, scheduling pain high | Variable | Medium | Time zones and virtual meetup tools | Later; product outcome differs from local real-world meetups |

The initial segment should be narrower still during discovery—for example: “Melbourne friend groups aged 27–38 with 4–8 members, at least two different calendar providers, and an existing monthly intention that often slips.”

## 7. Recommended product scope

### 7.1 MVP: prove the hard outcome before building a new calendar

The MVP should be a mobile-friendly web flow plus a lightweight organiser account. Do not begin by building a full calendar replacement, public social feed, venue marketplace, chat platform, or AI concierge.

#### Core workflow

1. Organiser creates a private circle or one meetup intent.
2. Organiser chooses a window, duration, required people/quorum, and optional location radius.
3. The product imports the organiser's free/busy data or accepts manual availability.
4. Friends receive a secure link and can:
   - confirm pre-filled free/busy if they connect a calendar;
   - mark a few socially available windows manually;
   - say “interested, decide for me,” “not this time,” or “need more notice.”
5. The engine proposes the best two options and explains the trade-off.
6. A member confirms the winner; the product writes calendar invites and sends reminders.
7. After the event, a one-tap check records whether it happened.

#### Essential product principles

- Calendar connection is optional and progressive.
- Request only free/busy scope where possible.
- No invitee account is required for the first plan.
- No event titles are shared by default.
- “No response” has a defined policy.
- A slot may win without 100% attendance.
- The group chooses the amount of automation.
- Every notification should advance a decision.

### 7.2 Phase two, only after activation is proven

- Persistent circles and recurring cadence.
- Private/threshold meetup sparks.
- Social-window rules and spontaneity mode.
- Preferred venues, budgets, travel limits, and activity types.
- Calendar integrations across Google, Apple/device calendars, and Microsoft.
- Fair rotation of organisers or automatic creation of proposals.
- Shared meetup history and optional memories.
- Community-host controls and reusable subgroups.

### 7.3 Features to defer

- Public discovery or meeting strangers.
- A general-purpose group chat.
- Full social feed, likes, follower graph, or status sharing.
- Venue booking and payments.
- Complex AI-generated activities before time coordination works.
- Auto-booking without explicit, narrow group rules.
- Mental-health or loneliness treatment claims.

These features create safety, moderation, supply, and marketplace problems before the core behaviour is validated.

## 8. Business model

### 8.1 Recommended packaging

Use **organiser-led freemium**:

- Free for every invitee and for basic meetup coordination.
- Free tier includes at least one persistent circle and enough completed meetups to experience the recurring value.
- One payer can unlock benefits for a whole circle, similar to Cupla's couple-level logic.
- Premium is for automation and ongoing relationship outcomes, not the ability to see whether friends replied.

Potential paid benefits:

- More persistent circles or larger groups.
- Multiple connected calendars and advanced availability rules.
- Recurring cadence and automatic suggestions.
- Private/threshold sparks and spontaneity controls.
- Smart response chasing and provisional holds.
- Travel, budget, childcare, and location optimisation.
- Advanced privacy controls and group history.
- Community organiser tools, attendance insights, and reusable audiences.

Candidate test pricing, not a recommendation to launch unchanged:

- Individual/circle supporter: approximately A$5–8 monthly or A$45–70 annually.
- Community organiser: approximately A$12–25 monthly depending on group size and frequency.
- A one-time “plan this meetup” purchase could test willingness to pay before a subscription, but it may reduce network adoption.

Howbout and TimeTree protect core planning in free tiers and charge mainly for personalisation/convenience. TimeTree charges A$4.49 monthly or A$42.99 annually in Australia; Cupla lists US$4.99 monthly or US$44.99 annually per couple. These are useful anchors, not direct proof of the proposed product's willingness to pay. [TimeTree pricing](https://support.timetreeapp.com/hc/en-us/articles/4647239978905-What-is-TimeTree-Premium) and [Cupla pricing](https://cupla.app/blog/shared-google-calendar-vs-cupla-for-couples/)

### 8.2 Why subscription is not yet proven

Scheduling a single meetup is transactional. A subscription becomes justified only if the app repeatedly:

- monitors for good opportunities;
- maintains several important circles;
- reduces organising labour every month;
- learns preferences and produces better results;
- helps protect a relationship cadence users care about.

This follows the consumer SaaS framework in [consumer-saas-success-research.md](./consumer-saas-success-research.md): the recurring outcome must exist independently of billing. If retained groups use the product only quarterly, annual family/circle plans, event credits, organiser subscriptions, or partner revenue may fit better than a monthly consumer subscription.

Avoid advertising based on calendar data. TimeTree has demonstrated that calendar-adjacent advertising is commercially possible, but for this product it would undermine the strongest potential differentiator: trust.

## 9. Distribution strategy

### 9.1 Product-led group acquisition

The product has a natural invitation loop:

```text
One motivated organiser
→ 3–8 friends receive a useful link
→ meetup is confirmed
→ invitees see personal value
→ one creates the next circle or plan
```

The loop fails if the invite resembles a request to do setup work. The landing experience should show the group, intent, privacy promise, response time (“20 seconds”), and immediate options before asking for an account.

### 9.2 Recommended early channels

- Founder-led recruitment of intact Melbourne friend groups, not isolated individual beta users.
- Shift-work communities: nurses, hospitality teams, emergency services, retail, aviation, and rostered workers.
- Local creators who speak about adult friendship, moving cities, parenthood, or maintaining relationships after university.
- Group organisers in run clubs, social sports, book clubs, gaming groups, and alumni communities.
- Search and shareable tools around “find when friends are free,” but only if the free tool funnels into persistent circles.
- A public “social coordination health check” or group scheduling calculator could create search demand without exposing private data.

Partiful's concentration in the US and iOS suggests room for a cross-platform product with an Australia-first community, while Howbout's growth through TikTok shows that a social-calendar concept can spread visually. Neither fact eliminates the challenge of getting whole groups activated.

## 10. Trust, privacy, and safety

Calendar data can reveal health appointments, religious events, employers, addresses, travel, relationships, and periods when a home may be empty. Trust should be a product feature, not a policy page.

Recommended posture:

- Store and share free/busy blocks wherever feasible, not titles or descriptions.
- Separate calendar feasibility from voluntarily declared social availability.
- Allow per-circle and per-window visibility.
- Give users a preview of exactly what others will see.
- Make manual availability a first-class experience.
- Show connection status and last successful sync.
- Provide export, disconnect, and deletion controls.
- Never use calendar data for advertising.
- Do not infer sensitive activities from event content.
- Minimise retention of raw calendar data.
- Conduct a threat model before enabling location-aware spontaneity.

Google offers a narrower `calendar.freebusy` OAuth scope, and public apps using user-data scopes must complete the appropriate verification process. Apple requires full calendar access to read events; write-only access cannot read them, so the consent request must clearly explain why full access is needed. [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) and [Apple EventKit access](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)

For an Australian launch, the OAIC's current guidance emphasises data minimisation and collecting only personal information reasonably necessary for the service. Obtain specific, informed consent and assess legal obligations before launch. [OAIC APP 3 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information)

Safety implications of anonymous and spontaneous features:

- Only allow them inside mutually joined private circles.
- Reveal aggregate interest after a configurable threshold.
- Rate-limit prompts and allow quiet periods.
- Give every person block, leave, and report controls.
- Do not expose exact live location; use user-selected areas or on-device proximity where possible.
- Do not automatically add people to a plan because a calendar is empty.
- For minors, either exclude them initially or design dedicated age, consent, and safeguarding controls.

## 11. Key risks

| Risk | Why it matters | Mitigation / test |
|---|---|---|
| **Whole-group activation** | One enthusiastic person cannot create value if friends refuse setup | Link-first participation; test completion by group size and installation requirement |
| **Howbout/Partiful feature response** | Direct competitors can copy isolated features | Own a narrower post-25 relationship outcome and compound private group context |
| **Calendar trust** | Permission denial prevents passive matching | Manual social windows; request narrow scopes progressively; strong privacy explanation |
| **Free does not mean available** | Bad suggestions create notification fatigue and distrust | Separate feasibility from willingness; learn notice, energy, duration, travel, budget |
| **No one wants to decide** | Calculating overlap still does not produce a meetup | Defaults, deadlines, quorum, provisional holds, and explicit decision ownership |
| **Low use frequency** | Monthly or quarterly use may not sustain subscription or habit | Persistent circles, relationship cadence, passive monitoring; measure completed meetups per group |
| **Notification fatigue** | A social-good message can become guilt or spam | Thresholded high-signal alerts, digests, frequency caps, positive language |
| **Overclaiming loneliness impact** | Scheduling is not a treatment for loneliness | Promise coordination outcomes; study social impact separately and ethically |
| **Cross-platform sync complexity** | Reliability failures destroy core trust | Start with one or two calendar paths, expose sync state, invest in integration testing |
| **Social exclusion and anonymity** | Anonymous triggers can intensify group dynamics | Private circles, aggregate reveal, auditability, member controls, no anonymous chat |

## 12. Validation plan before a full build

### Phase 1: problem discovery — 20–30 interviews

Recruit intact groups, including both organisers and passive members. Interview separately so the organiser does not dominate the account.

Target mix:

- 6–8 Melbourne friend groups aged 25–40.
- 3–4 shift-worker groups.
- 3–4 couples with different schedules.
- 3–4 hobby/community organisers.

Ask for the last real attempt, not opinions about a hypothetical app:

- “Tell me about the last meetup that was discussed but did not happen.”
- “Show me the messages from the moment someone suggested it.”
- “Who usually initiates, follows up, and decides?”
- “Which step took the longest?”
- “What does an empty calendar slot fail to tell me?”
- “What calendar details would you never share, even with this group?”
- “When have you ignored a poll or invitation, and why?”
- “How many people have to attend for the meetup to feel worthwhile?”
- “Would a private ‘I am interested’ signal change whether you initiate?”
- “What existing app would this have to replace or coexist with?”
- “What would make you pay, and who in the group should pay?”

Evidence to seek:

- At least weekly/monthly attempts to coordinate.
- Repeated failed or delayed plans.
- Existing labour: polls, spreadsheets, calendar screenshots, or message chasing.
- Privacy boundaries that can still support useful matching.
- A clear motivated organiser and a plausible reason for other members to respond.

### Phase 2: concierge test — 10–15 groups for four weeks

Before calendar integrations, manually deliver the result:

1. Groups provide calendar screenshots, free/busy exports, or a short availability form.
2. A lightweight service sends two proposed meetup windows.
3. Members respond through unique links.
4. The service applies quorum/deadline rules and confirms the event.
5. Measure whether the meetup happened.

This isolates whether proactive matching and safer initiation change behaviour before investing in sync infrastructure.

### Phase 3: prototype experiments

Run separate tests so the winning mechanism is identifiable:

- Manual poll versus calendar-prefilled availability.
- Named initiation versus threshold-private initiation.
- Perfect overlap versus best quorum.
- App-required versus no-account web response.
- Time-only suggestion versus time + suitable location.
- One-off planning versus a monthly circle cadence.

### Phase 4: willingness-to-pay test

After at least two successful meetups, show a real paywall for continued automation. Test who pays:

- the initiating individual;
- one circle supporter on behalf of the group;
- the community organiser;
- nobody, indicating another revenue model is required.

Do not use survey willingness alone. Measure checkout starts and completed purchases, with a clear refund or beta-access policy.

## 13. Metrics and decision gates

The north-star metric should be:

> **Confirmed meetups that participants report actually happened, per activated circle per month.**

Supporting funnel:

| Stage | Metric |
|---|---|
| Acquisition | Intact groups started by source, not individual downloads |
| Activation | Percentage of new circles that confirm a meetup within 7 days |
| Invitation | Invite-link open rate and response rate without an account |
| Setup friction | Median seconds to first response; calendar-connect acceptance |
| Decision quality | Time from first spark to confirmed plan |
| Inclusion | Attendance coverage and use of quorum versus unanimity |
| Real outcome | Percentage of confirmed meetups reported as happened |
| Group retention | Circles confirming another meetup within their intended cadence |
| Advocacy | Participants who initiate a new plan or circle |
| Trust | Permission denial, disconnect, deletion, complaint, and report rates |
| Monetisation | Activated circle → trial → paid; payer role; renewal by segment |

Suggested pre-build or early-beta gates:

- At least 60% of invited members answer a link without personal chasing.
- At least 50% of activated circles confirm a plan within seven days.
- At least 70% of confirmed plans are reported as having happened.
- At least 30% of successful circles initiate a second plan within the observed cadence.
- Calendar connection materially improves confirmation time or response effort over manual input.
- A meaningful subset pays after experiencing at least two successful meetups.

These are directional thresholds for learning, not industry benchmarks. Segment results by group size, relationship type, calendar provider, organiser role, and whether all members installed.

## 14. Recommended next decision

Proceed to discovery, not full product development.

The concept passes the **problem importance** and **existing behaviour** tests. It has promising invitation-led distribution and a natural recurring trigger if positioned around relationship cadence. It does not yet pass the **specific differentiation**, **whole-group activation**, or **willingness-to-pay** tests.

The next hypothesis to validate is:

> For an existing 3–8 person friend group of busy adults in one city, a no-install, privacy-preserving service that combines free/busy data with willing social windows and confirms the best quorum-based meetup will produce more completed meetups with less organiser chasing than their group chat and current calendars.

If that hypothesis is supported, build the smallest persistent-circle product around it. If groups like the idea but do not respond without chasing, the core problem is motivation and social dynamics rather than scheduling; the product thesis will need to shift. If groups successfully coordinate but will not pay, pursue organiser/community pricing, transaction revenue, or a free relationship product with a different commercial layer rather than forcing a consumer subscription.

## Sources consulted

### Market and social context

- [WHO — From loneliness to social connection](https://www.who.int/publications/i/item/978240112360)
- [Australian Institute of Health and Welfare — Social isolation and loneliness](https://www.aihw.gov.au/mental-health/topic-areas/health-wellbeing/social-isolation-and-loneliness)
- [Australian Bureau of Statistics — How Australians use their time, 2024](https://www.abs.gov.au/statistics/people/people-and-communities/how-australians-use-their-time/2024)
- [OutWithFriendz group-event scheduling study](https://arxiv.org/abs/1710.02609)

### Products, scale, and pricing

- [Howbout product](https://howbout.app/about)
- [Howbout funding and usage announcement](https://howbout.app/blog/howbout-moments/we-raised-8m-in-funding-led-by-goodwater-/)
- [TechCrunch — Howbout Series A](https://techcrunch.com/2024/09/13/howbout-raises-8m-from-goodwater-to-build-a-calendar-that-you-can-share-with-your-friends/)
- [TimeTree product](https://timetreeapp.com/intl/en)
- [TimeTree pricing](https://support.timetreeapp.com/hc/en-us/articles/4647239978905-What-is-TimeTree-Premium)
- [Cupla shared calendar and pricing](https://cupla.app/shared-calendar-app-for-couples/)
- [Cupla Relationship Survey 2023](https://cupla.app/wp-content/uploads/2024/06/Relationship-Survey-2023.pdf)
- [Partiful App Store listing](https://apps.apple.com/us/app/partiful-party-invite-maker/id1662982304)
- [TechCrunch — Partiful adoption and funding](https://techcrunch.com/2024/11/18/partiful-is-googles-best-app-of-2024/)
- [Apple Invites announcement](https://www.apple.com/newsroom/2025/02/introducing-apple-invites-a-new-app-that-brings-people-together/)
- [Doodle mobile app pause](https://doodle.com/en/doodle-mobile-app-change/)
- [Hangs](https://hangs.ai/), [Sha](https://www.shasocial.com/), [Flare](https://shootaflare.com/), [SoKal](https://sokal.app/), [Frae](https://frae.app/), and [Sponta](https://get-spontaneous.com/)

### Reviews and qualitative evidence

- [Howbout App Store reviews — Australia](https://apps.apple.com/au/app/howbout-shared-calendar/id1477248221?platform=iphone&see-all=reviews)
- [TimeTree App Store reviews — United States](https://apps.apple.com/us/app/timetree-shared-calendar/id952578473?platform=iphone&see-all=reviews)
- [TimeTree current bug report](https://support.timetreeapp.com/hc/en-us/articles/360000329822-Bug-Report)
- [Partiful App Store reviews — United States](https://apps.apple.com/us/app/partiful-party-invite-maker/id1662982304?see-all=reviews)
- [Cupla App Store reviews — United States](https://apps.apple.com/us/app/cupla-couples-shared-calendar/id1557764033?platform=ipad&see-all=reviews)
- [Doodle Trustpilot reviews — Australia](https://au.trustpilot.com/review/www.doodle.com)
- [When2meet mobile/calendar discussion](https://www.reddit.com/r/UCDavis/comments/1b6nrly/extremely_frustrated_with_when2meet/)
- [When2meet/LettuceMeet alternatives discussion](https://www.reddit.com/r/opensource/comments/1dlol7r/i_made_a_better_when2meet/)

### Technical and privacy constraints

- [Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Apple EventKit calendar access](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)
- [OAIC — APP 3 collection and data minimisation](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information)


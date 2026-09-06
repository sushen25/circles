# MVP spec review: verification, validation and enrichment

_Status: review for decision_

_Date: 6 September 2026_

_Reviewed document: [initial MVP product spec](./initial-mvp-product-spec.md) (26 August 2026)_

_Inputs: [meetup market research](./research/meetup-market-research.md), [consumer SaaS success research](./research/consumer-saas-success-research.md), [software moats research](./research/software-moats-research.md), [branding research](./research/branding-research.md), [design manifesto](./design-manifesto.md), plus targeted external verification carried out on 6 September 2026 (sources at the end)._

## 1. Overall verdict

The spec is in good shape. It makes the right foundational choices, it is consistent with the research on every load-bearing point (no-install participation, willingness over free/busy, quorum with human confirmation, persistent circles, "reported happened" as the north star, trust as architecture), and almost every external fact it relies on checked out.

The review therefore concentrates on four things:

1. A small number of **internal contradictions** that would surface as bugs or trust failures if built as written. The most important is that the quiet spark reveals its initiator through the organiser role.
2. **Evidence the research did not have** because it post-dates it or was out of scope: WhatsApp's August 2026 poll changes, Safari's storage deletion policy and in-app browser isolation, EAS Hosting's custom-domain restriction, Weavv, and Australia's social media minimum-age law.
3. **Places where the spec diverges from the research** and whether the divergence is justified (mostly it is; one is not).
4. **Enrichments** that make the MVP a sharper experiment for the same or less build effort, including a proposed re-ordering of the delivery slices.

Recommended changes are ranked in section 6. If only three are adopted, they should be: fix the quiet-spark identity leak (6.1), design identity continuity for no-install participants as a core flow rather than an edge case (6.2), and swap the order of Slices 2 and 3 (6.4).

## 2. Internal consistency issues in the spec

These are things the spec says that conflict with other things the spec (or its companion documents) say. Section references are to the spec unless stated.

| # | Issue | Where | Why it matters |
|---|---|---|---|
| C1 | **Quiet spark initiator is revealed by the organiser role.** Step 8 makes the initiator the organiser by default, then says the interface must not name the initiator "unless they choose to reveal themselves". But the organiser is visible on every plan screen, in confirmation copy, and in "candidates ready" notifications. | §5.4 step 8; §4.4 roles; §8.2 invariant "quiet-spark identity ... not exposed" | The one safety promise the feature makes is broken by its own default. See 6.1. |
| C2 | **"Tonight" response deadline is contradictory.** "One hour or 30 minutes before the plan window ends, whichever comes first" always resolves to one hour before the window ends, which for a 7 pm spark with an 11:30 pm window means replies close at 10:30 pm — far too late to be useful. | §5.3 | The intended rule is probably "the earlier of 60 minutes after creation or 30 minutes before the last possible start". Needs rewriting. |
| C3 | **Audience for candidates is undefined.** §5.5 says the organiser may see per-member attendance per candidate; §5.6 says each option shows "names of those who can attend" without saying to whom; §7 web routes say "view candidates if authorised" without defining authorised. | §5.5, §5.6, §7 | Design manifesto §3.4 assumes every member can see who's in, who's out and who hasn't answered. The spec should say so explicitly. |
| C4 | **Cadence state copy contradicts the brand rules.** Circle home shows "On track / Time to plan / No goal" and the pricing prompt says "Keep this circle on track automatically". Branding research §6.5 explicitly says to avoid "stay on track" and audit framing; design manifesto §8 bans "you haven't met in X" framing. | §5.2 circle home; §5.11 | Small, but this is exactly the copy the brand work says defines the product. Suggest "Next one's due soon" / "No rush" / "No goal set". |
| C5 | **Cadence prompt concentrates labour on the same person.** "Show Time to plan another to the owner or most recent organiser" reinforces the unpaid-coordinator role the product exists to dissolve (H5, moats research §6.1 "allow organiser responsibility to move between members"). | §5.9 | See 6.6: optional rotation. |
| C6 | **Slice 1 organiser has no notification channel.** Push arrives in Slice 2, invitee email is for anonymous members only, so in Slice 1 the signed-in organiser learns that candidates are ready or the deadline passed only by opening the app. | §5.8, §18 | The owner has a verified email from sign-in. Organiser-facing email (candidates ready, deadline passed with no decision, did it happen, cadence) is nearly free and removes the dependency on native push for the organiser loop. |
| C7 | **Availability retention undermines the stated learning moat.** Availability windows are deleted 30 days after a plan completes, yet the moats research (§6.4) and the spec's own "Plan another" defaults rely on remembering how members respond. | §14 retention; moats §6.4 | Willing windows are the least sensitive data in the system (they are what friends already see in aggregate). See 6.9. |
| C8 | **Pricing fake door is scheduled for a cohort where it cannot produce evidence.** §5.11 fires after two happened meetups; §2.2 says the founder's groups cannot establish willingness to pay. | §5.11, §2.2 | Gate the prompt to non-founder circles only. |
| C9 | **Product name is undefined across documents.** The spec never names the product; moats and branding research call it "Rounds"; the repository is `circles`; the branding research says to stop building equity in Rounds. | Spec header; moats §title; branding §10.2 | The spec should state the internal codename, that it is a placeholder, and what "circle" means in-product versus as a brand claim (branding §7.2). |
| C10 | **Broken cross-references.** Spec header links `../consumer-saas-success-research.md` and `../meetup-market-research.md` (actual path `./research/...`). Moats research links a `technical-architecture.md` that does not exist. Branding research links the spec and manifesto with `./` paths from inside `research/`. | Headers | Cosmetic, but coding agents will follow these paths. |
| C11 | **Quorum arithmetic edge.** Default quorum `max(2, ceil(active × 0.6))` includes the organiser, and required members default to the organiser. In a three-person circle quorum is 2, so "organiser + one other" confirms — fine — but the spec should say whether required members count toward quorum (they should). | §5.2, §5.6 | Ambiguity an agent will resolve arbitrarily. |

## 3. Alignment with the research

Where the spec follows the research, this section says so briefly. Where it diverges, it says whether the divergence is justified.

### 3.1 Followed, and correctly

The seven unmet needs in the market research (no-install participation, passive privacy-preserving availability, intent-not-just-time, best-enough scheduling, a response and decision engine, safe spontaneity, shared organising labour) each map to a spec section (§5.1, §5.5, §5.5, §5.6, §5.3/§5.7, §5.4, §5.4/§5.9). The consumer SaaS ordering (recurring outcome → first-session value → retention loop → positioning → distribution → pricing) is reproduced in §23. The moats research's P0 mechanisms (private circle, trust as infrastructure, invitation loop) are all present. The design manifesto's eight principles are consistent with the spec's copy and acceptance criteria, with the exceptions in C4 above.

### 3.2 Justified divergences

**Persistent circles in the MVP rather than phase two.** The market research (§7.1–7.2) put circles and cadence in phase two; the spec brings them into the MVP. The moats research written afterwards makes the circle the P0 compounding asset, and the spec's Slice 1 still works as a one-off flow if the circle concept fails. Keep.

**Local device-calendar overlay instead of provider free/busy.** The market research assumed Google `freebusy` scope; the spec chose local-only reading via `expo-calendar`. This is the more trust-consistent choice and avoids Google's app-verification process. Keep, but see 6.4 on when to build it.

**Three candidates instead of two.** The research said "the best two options"; the spec says three with date diversity. Three is fine; the important property (a small, explained set, not a heat map) is preserved.

### 3.3 Divergence that is not fully justified

**Skipping discovery and the concierge test.** The market research's "recommended next decision" (§14) is explicit: proceed to discovery (20–30 interviews) and a concierge test, not product development. The spec goes straight to a build, on the reasonable grounds that agent-assisted building is now cheap enough that the Slice 1 build *is* the concierge test. That is partly true, but two things are lost:

- The interview questions ("tell me about the last meetup that was discussed but didn't happen", "show me the messages") produce copy, defaults and deadline values that the spec currently guesses at (5:30–10:30 pm weekday windows, 24/72-hour deadlines, quorum 60%).
- Recruiting 8–10 non-founder groups is the real schedule bottleneck for the second cohort, and it takes weeks of lead time that can start now.

Recommendation: run 6–8 short interviews (both organisers and passive members, interviewed separately) in parallel with Slice 0, and begin recruiting the external cohort at the same time. Do not block the build on it.

## 4. External verification of load-bearing claims

Every claim below was checked against a primary source on 6 September 2026.

| Claim in spec | Result | Note |
|---|---|---|
| Expo SDK 57 is current | **Confirmed.** Released 30 June 2026 on React Native 0.86 / React 19.2. | The changelog reiterates that Expo Go is not for production; development builds are needed for calendar and push, as the spec says. |
| Expo Router `web.output: single` and EAS Hosting on the free plan | **Confirmed, with a catch.** EAS Hosting is available to free accounts, but **custom domains are paid-only**. | Invite links on the free plan would be `*.expo.app`. See 6.7. |
| `expo-notifications` covers push | **Confirmed for iOS/Android only.** No web push support; Android push requires a development build (not Expo Go) since SDK 53. | Confirms that web-only members must rely on email and the shared link. The spec should state that Web Push is out of scope. |
| Supabase Free: 500 MB DB, 50k MAU, 500k Edge Function invocations, 2M Realtime messages, pauses after one week of inactivity, no backups | **Confirmed.** Also a limit of two active projects. Pro from US$25/month. | |
| Supabase anonymous sign-in guidance | **Confirmed.** Turnstile/CAPTCHA "strongly recommended"; default IP rate limit of 30 anonymous sign-ins per hour; no automatic cleanup (manual `delete ... where is_anonymous`); use restrictive RLS with the `is_anonymous` claim. | The 30/hour/IP default could bite when a whole household or office joins from one network. Raise the limit or exempt via Turnstile before the external cohort. |
| Resend Free: 3,000/month, 100/day, three domains, one webhook | **Confirmed.** 30-day data retention; Pro US$20/month. | The 100/day cap is fine for the private beta but a single 12-person circle confirming twice in a day with reminders is ~50 emails; watch it once cohort two starts. |
| Doodle paused its mobile apps in August 2026 | **Confirmed.** Apps removed from stores; web and home-screen web app remain. | Supports the spec's web-first choice. |
| Australian Spam Act: consent, identification, unsubscribe within five working days | **Confirmed** (as cited in spec). | |
| Partiful supports date polling before an event | **Confirmed.** "Find a Time": host writes in candidate dates/times, guests vote Yes/No/Maybe without an account, host picks one and votes convert to RSVPs. | This is host-proposed slots, not willing windows plus a candidate engine — the difference the spec should articulate. |
| Apple Invites remains event-first, iPhone-only for hosts | **Confirmed.** Updates in April and July 2026 added iMessage sharing, guest-list editing, time-zone specification, reactions. No polling or availability. | |
| Howbout scale | **Updated.** Site now claims 10M downloads, 200M plans, 4.8★ from 75k reviews, "check everyone's availability and find a time". | The moats research already has these figures; the market research's 4M figure is stale. |

## 5. New evidence the research did not have

### 5.1 WhatsApp polls now have deadlines and hidden voters (4 August 2026)

WhatsApp announced group polls with an end time that locks voting, the option to hide voter identities, and `@all` mentions. Combined with WhatsApp Events (RSVP with "maybe", plus-ones, pinning, available in groups since 2024 and 1:1 chats since April 2025), the incumbent group chat can now run a crude version of the quiet spark: an anonymous "who's keen this weekend?" poll with a deadline, followed by an event with RSVPs.

Implications for the spec:

- The competitive framing in §3 and the share-sheet copy in §5.8 should be written against *this* WhatsApp, not the 2024 one. The product's remaining edge is precise: willing *time windows* rather than a yes/no vote, a candidate engine that finds best-enough overlap under quorum, a persistent circle that remembers the group, and an outcome loop. Anonymous interest alone is no longer differentiating.
- H5 (quiet initiation) now has a free, zero-install control condition. That is useful: a group that has tried anonymous WhatsApp polls and still stalls is exactly the group the spec is for. Add "have you used a WhatsApp poll for this?" to the interview script and to the organiser micro-survey (6.10).
- The market research's competitor table should get a row for WhatsApp Events and anonymous polls.

### 5.2 Anonymous web identity will be lost on the default path, not the edge

Two platform behaviours combine badly with the spec's "anonymous authenticated session tied to that browser/device":

- **Safari deletes all script-writable storage (localStorage, IndexedDB, service worker registrations) after seven days of Safari use without the user interacting with the site.** This applies to all sites, not only classified trackers. Supabase stores its session in localStorage on web. A member who responds on day one to a 14-day plan and next taps the confirmation link on day ten will arrive with no session.
- **Links tapped from WhatsApp, Messenger and Instagram open in in-app browsers whose storage is isolated from Safari and Chrome.** Apple documents that `SFSafariViewController` shares no website data with Safari; WebView-based in-app browsers are isolated in their own way. A member who responds inside WhatsApp's browser and later opens the link from iMessage, or chooses "Open in Safari", has a different storage context each time.

The spec lists "anonymous member clears browser data" as an edge case in §9 and accepts the limitation in §5.1. On the evidence it is the *expected* path for a meaningful share of web-only members over a two-week plan, which directly threatens H2 (response rate), the post-confirmation attendance correction, "I was there" corroboration, and the owner-facing duplicate-member cleanup burden. See 6.2 for the proposed design.

### 5.3 EAS Hosting free plan does not include custom domains

Confirmed on Expo's own documentation. For a product whose brand argument is trust, invite links must be on a domain the group recognises. Either budget for an EAS paid plan from Slice 1 or host the static `single` output on any static host with a custom domain (the output is plain static files). See 6.7.

### 5.4 Weavv: private mutual-interest reveal for friend groups

Weavv (London, iOS, pre-launch as at the branding research) shows a daily deck of activities, lets each member of a friend group swipe privately, and nudges one member when several want the same thing. It is activity-first rather than time-first and is not yet in market, but it is the closest thing to the quiet spark and confirms the mechanism is not proprietary. The moats research already says not to claim it as a moat; the spec's H5 wording should avoid "unique".

### 5.5 Australia's Social Media Minimum Age law (in force 10 December 2025)

Platforms whose sole or significant purpose is enabling online social interaction, where users can post material visible to others, must take reasonable steps to prevent under-16s holding accounts. Messaging-only, gaming, education and health services are excluded by rule. A private planning tool with no feed, profiles or posting is unlikely to be captured, but the definition is deliberately broad and applies regardless of size. The spec currently has no age floor at all. Recommendation: terms require users to be 18+, no under-16 accounts, and note in the privacy section that the product is not designed for minors (the market research §10 already advises excluding minors initially). Get this confirmed in the pre-public-launch legal review the spec already schedules.

## 6. Recommended changes, ranked

P0 changes should be made before Slice 1 is built. P1 before the external cohort. P2 are worth doing when cheap.

### 6.1 P0 — Fix the quiet-spark identity leak (C1)

Replace §5.4 step 8 with an explicit role-assignment step after threshold:

- When the threshold is met, the plan moves to availability collection with **no organiser**. The plan shows "Started quietly by someone in Sunday Crew".
- The initiator receives a private prompt: "Enough people are keen. Do you want to pick the time? Your name will show as the organiser." Options: **I'll organise** (reveals them as organiser, not as initiator, although members may infer it), **Ask for a volunteer**.
- "Ask for a volunteer" shows every interested member a one-tap **I'll pick the time** action; the first to tap becomes organiser. If nobody volunteers before the response deadline, fall back to the circle owner with a neutral prompt.
- Notification and email copy for a quiet plan never includes the organiser's name until an organiser exists, and never says who started it.
- Add to §8.2 invariants: "A quiet plan has no organiser until a member explicitly accepts the role."

This also gives H5 a sharper measurement: how often someone *other than* the initiator volunteers.

### 6.2 P0 — Design identity continuity for no-install participants as a core flow (5.2)

Treat "member returns with no session" as a designed state, not an edge case:

- **Continue-as flow.** When someone opens a circle or plan link with no session, show the circle's current members and offer **Continue as [name]** for any anonymous member without a permanent identity, alongside **I'm new here**. Tapping "Continue as Priya" reattaches the new anonymous session to Priya's membership and existing responses. Impersonation risk inside a private friend group is low, is visible to the group, and is reversible by the owner; it is far lower than the cost of duplicate members and lost responses. Record `member_reattached` and show a small "Priya rejoined from a new device" line to the owner.
- **Personal links in every email.** Any event email to a verified contact deep-links with a single-use, short-lived re-entry token so the person lands in their own membership regardless of browser. The spec's `email_action_tokens` table already supports this with a new `purpose`.
- **Move "Save access on every device" earlier for organisers of quiet plans**, since a web-only organiser who loses their session cannot confirm.
- **Instrument it.** Add `session_missing_on_return`, `member_reattached`, `duplicate_member_removed` to §11.3, and add "share of returning web members who needed to reattach" to the funnel. This is a first-cohort question the founder's groups *can* answer well.
- Note in §10 that in-app browsers are the default entry point from group chats and that the web build must be tested inside WhatsApp's and Messenger's browsers, not only mobile Safari and Chrome.

### 6.3 P0 — Re-state differentiation against the 2026 group chat (5.1)

Add to §1 or §3 a short "what the group chat can already do" paragraph and a one-line answer: anonymous polls and RSVPs find *whether* people are keen; the product finds *when* enough of them can actually make it and stays with the group until it happened. Update the share-sheet examples in §5.8 so the invite copy names the specific gain ("mark the times you'd actually be up for; we'll find the evening that works for most of us") rather than positioning against WhatsApp.

### 6.4 P0 — Swap Slices 2 and 3 (§18)

Current order: web end-to-end → native calendar overlay and push → quiet spark, presets, cadence, plan-another. Proposed order:

1. **Slice 0** foundation, plus interviews and external-cohort recruitment in parallel (3.3).
2. **Slice 1** web end-to-end, unchanged except: organiser email notifications (C6), continue-as flow (6.2), flexible response (6.5), no marketing-consent machinery (6.8).
3. **Slice 2 (was 3)** the relationship loop, still entirely on web: quiet spark with the fixed role step, tonight/weekend presets, cadence with optional rotation, plan-another defaults, corroborated attendance. Pricing door only for non-founder circles.
4. **Slice 3 (was 2)** native: development builds, calendar overlay, push, native add-to-calendar. Build only if Slice 1 evidence says manual availability entry is the bottleneck (the spec's own post-MVP decision tree, §22, says not to build calendar sophistication first if the bottleneck is motivation or reach).
5. **Slice 4** hardening, plus marketing consent if still wanted.

Reasons: the swapped Slice 2 tests H4, H5 and H6 — the hypotheses the research rates as the actual differentiation — with zero native cost and no TestFlight friction for the founder's friends. The old Slice 2 requires app-store developer accounts, EAS builds and per-tester installation to test H3, which the research (§4.3 D and §22) considers the least likely bottleneck. Push for organisers is replaced by email (C6) until native exists.

### 6.5 P1 — Add the "flexible" and "need more notice" responses (market research §7.1)

§5.5 response outcomes lack the two answers that most reduce non-response:

- **"I'm easy — count me in for whatever works for most people"** at plan level, treated as available for every candidate inside the plan window. This is explicit willingness, so it does not violate manifesto §3.3, and it is the fastest honest answer a passive friend can give. Cap its effect: a candidate whose available set consists *only* of flexible responders should rank below one with at least one explicit window, so the engine still reflects real preferences.
- **"Not enough notice — try me with more warning"** as a distinct outcome from "not this time", stored as a circle-level hint used when pre-filling the next plan's window. This is the first, cheapest instance of the outcome-learning loop.

### 6.6 P1 — Let the cadence prompt rotate (C5)

Add a circle setting **Who gets nudged to plan the next one**: "whoever organised last" (current behaviour), "take turns" (round-robin among members who attended the last happened meetup and are not muted), or "the owner". Default to "take turns" for circles with four or more members. Log `cadence_prompt_recipient_role` so H5 can be read from cadence behaviour as well as from sparks.

### 6.7 P1 — Own the invite domain and the link preview (5.3)

- Host the web build on a custom domain from Slice 1: either an EAS paid plan or a static host with a custom domain. The `single` output is host-agnostic, so this is a configuration decision, not an architecture change.
- Serve **dynamic Open Graph tags for `/join` and `/plan` links**. Group chats render link previews; a generic preview wastes the first brand moment the branding research designs (§7.3 "invite preview"). Use Expo Router's `server` output on EAS Hosting or a tiny edge function that returns an HTML shell with `og:title` "Sunday Crew is finding a time to catch up" and `og:description` "Pick the times you'd actually be up for. No app needed." Include the circle name only; never member names, dates chosen, or anything from a quiet plan.
- Keep the invite secret in the URL fragment as specified; preview fetchers never receive it, which is a further reason to keep that design.

### 6.8 P1 — Cut the product-marketing consent machinery from Slice 1 (H8)

The email sections are roughly a fifth of the spec and half of that serves H8, the weakest hypothesis. Plan-update email for web-only members is necessary (it is how they learn the plan is confirmed). The separate marketing scope, campaign job, dry-run tooling, dual suppression state and consent-evidence tables are not needed to learn anything in the first two cohorts and add compliance surface before there is a product. Recommendation: ship plan-update email only in Slice 1; collect early-access interest through a plain waitlist on the landing page, which is a normal, obviously-marketing context; add the in-product marketing checkbox in Slice 4 if it is still wanted. Keep the consent-evidence schema design in the spec so it is not redone later.

### 6.9 P1 — Retain what the learning loop needs (C7)

Change availability-window retention from 30 days to 12 months for members of active circles, and derive a coarse per-member, per-circle "usual day-parts" summary (weekday evenings, weekend afternoons) that survives deletion of raw windows. Use it only to pre-fill that member's own next response, never to score them if they have not answered. This is the cheapest, most private version of the moats research's "circle defaults → transparent heuristics" sequence.

### 6.10 P1 — Measure chasing directly

§11.4 gates on "members respond without personal one-to-one chasing" and §11.2 lists "individual chasing reported", but nothing collects it. Add a one-question organiser micro-survey on the confirmation review screen: "Did you have to chase anyone outside the app?" (no / one person / more than one). Ask the same at outcome report for the meetup itself ("did the plan change outside the app?"). Two taps, and it produces the H2 evidence the spec currently cannot produce.

### 6.11 P2 — Smaller fixes

- Rewrite the tonight deadline (C2) as "the earlier of 60 minutes after the spark or plan is created, and 30 minutes before the last possible start".
- State that all active members can see candidates and per-candidate names before confirmation (C3), and that only the organiser can confirm.
- Rename cadence states (C4): "Next one's due soon", "No rush", "No goal set". Rename the pricing concept copy away from "on track".
- Add a member cap of 12 and a floor of 3 per circle for the MVP; the candidate cards and quiet threshold are designed for that range.
- State that required members count toward quorum (C11).
- Add a Google Calendar template URL beside the `.ics` download for Android web users; `.ics` downloads on Android are unreliable.
- Note that Web Push is out of scope and that web-only members rely on email and shared links.
- Raise the Supabase anonymous sign-in IP rate limit above 30/hour before the external cohort, or front joins with Turnstile earlier than Slice 4.
- Add an 18+ requirement to terms and an explicit "not designed for minors" line in §16 (5.5).
- Fix cross-references (C10) and add a "Name" line to the spec header: internal codename, status "placeholder, replacement under validation (see branding research)".
- Add the "organiser stalls after the deadline" case to §9: one reminder at deadline, a second at deadline plus 24 hours offering **hand this to someone else**, and, as an opt-in circle setting worth testing under H4, **let anyone lock in the top option after the deadline**.
- Update the market research's competitor table with WhatsApp Events / anonymous polls, Partiful Find a Time, and Weavv, and refresh Howbout's scale figures.

## 7. Revised hypothesis table

Only the rows that change are listed.

| ID | Change |
|---|---|
| H2 | Add: "and returning web-only members can reattach to their membership without owner intervention in at least 80% of cases" (6.2). |
| H3 | Reword as conditional: tested only if Slice 1 shows that availability entry, not motivation or reach, is the bottleneck. |
| H5 | Add measurement: "someone other than the initiator accepts the organiser role in at least one quiet plan" (6.1); control condition: groups that have tried anonymous WhatsApp polls (5.1). |
| H8 | Narrow to plan-update email only: "verified plan-update email does not reduce response completion". Marketing opt-in is removed from MVP hypotheses (6.8). |
| New H9 | "A flexible response option raises response rate among passive members without degrading candidate quality" (6.5). Evidence: share of responses that are flexible; candidate acceptance when flexible responders are in the majority. |

## 8. Open questions for the founder

1. How long will recruiting 8–10 non-founder groups take, and who owns it? It is the actual critical path to any retention or payment evidence, and it can start now.
A. I'll handle the initial recruitment.
2. Is there appetite for the "continue as" reattachment model (6.2), or would you rather accept duplicate members and measure the loss first?
A. Yes definitely do the "continue as" model.
3. Should the pricing door be dropped from the MVP entirely and replaced by the interview question, given it cannot fire in the first cohort and the research says survey intent is weak evidence?
A. Yes we'll do pricing later
4. Are you comfortable deferring native to Slice 3, given it delays the calendar-overlay trust test that the design manifesto flags as an open question?
A. Yes
5. Codename: keep "Rounds" internally, switch to "Circles" (the repo name), or use the branding research's placeholder "Samesoon — plans with friends" for the prototype?
A. Use circles as the code name. It will be changed later.

## Sources

### Existing project documents

- [Initial MVP product spec](./initial-mvp-product-spec.md)
- [Meetup market research](./research/meetup-market-research.md)
- [Consumer SaaS success research](./research/consumer-saas-success-research.md)
- [Software moats research](./research/software-moats-research.md)
- [Branding research](./research/branding-research.md)
- [Design manifesto](./design-manifesto.md)

### Stack and vendors (verified 6 September 2026)

- [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57)
- [EAS Hosting — get started](https://docs.expo.dev/eas/hosting/get-started/)
- [Expo Notifications reference](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Resend pricing](https://resend.com/pricing)
- [Doodle mobile app change](https://doodle.com/en/doodle-mobile-app-change/)

### Competitors and incumbents

- [WhatsApp — better polls, @all and more (4 August 2026)](https://blog.whatsapp.com/your-group-chats-upgraded-introducing-better-polls-all-and-more)
- [WhatsApp — feature roundup including Events (9 April 2025)](https://blog.whatsapp.com/new-feature-roundup-updates-to-group-chats-events-calls-channels-and-more)
- [Partiful — Find a Time](https://help.partiful.com/en-us/articles/15525423-using-find-a-time-to-poll-guests-on-date-and-time)
- [Howbout — groups](https://howbout.app/groups)
- [Apple Invites update, April 2026 (Cult of Mac)](https://www.cultofmac.com/news/apple-invites-app-updates)
- [Apple Invites update, July 2026 (MacRumors)](https://www.macrumors.com/2026/07/21/apple-invites-app-two-new-features/)
- [Weavv](https://www.weavv.io/)

### Platform and legal

- [WebKit — full third-party cookie blocking and 7-day cap on script-writable storage](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
- [Apple — SFSafariViewController](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller)
- [Gadens — Australia's social media minimum age restriction](https://www.gadens.com/insights/no-likes-before-sixteen-australias-social-media-minimum-age-restriction)
- [eSafety Commissioner — social media age restrictions](https://www.esafety.gov.au/about-us/industry-regulation/social-media-age-restrictions)

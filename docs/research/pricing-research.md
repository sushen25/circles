# Pricing strategies for Wenna

_Research date: 16 October 2026_

_Product context: [MVP product specification](../mvp-product-spec.md), [meetup market research](./meetup-market-research.md), [consumer SaaS success research](./consumer-saas-success-research.md), [software moat research](./software-moats-research.md), [brand strategy research](./branding-research.md), [design manifesto](../design-manifesto.md) and [technical architecture](../technical-architecture.md)_

_Status: candidate strategies for the willingness-to-pay test. Nothing here is priced in the product. The spec excludes subscription billing and any pricing fake door from the MVP; willingness to pay is explored in the post-meetup interviews and tested later with a real checkout._

## Executive conclusion

Wenna's pricing has to fit a product whose core loop is free for everyone, whose invitees never install anything, and whose groups meet monthly or slower. That rules out most of the category's usual plays and leaves a small set of honest options.

The recommended shape is **organiser-led freemium with one payer per circle**: everything in the coordination loop stays free, and a single supporter unlocks the automation that makes the next meetup easier for the whole circle. Annual pricing fits a monthly rhythm better than monthly pricing does.

The recommended sequence is:

1. **Now:** no pricing in the product. Ask about payer, price and value in the post-meetup interviews.
2. **First real test:** a voluntary morning-after contribution, offered once "I was there" is tapped, in non-founder circles only. It needs no premium feature and gives a completed-payment signal within weeks of the external cohort.
3. **Second real test:** an annual circle supporter at about A$49, offered after the second happened meetup once cadence automation and the calendar overlay exist.
4. **Expansion, only if friend groups love it but will not pay:** an organiser tier for groups that meet weekly, where willingness to pay is highest.

Friend-group pricing can sustain the product but is unlikely to fund growth on its own. The organiser tier is the eventual second engine.

## 1. What any strategy has to respect

These constraints are already set by the research, the manifesto and the spec. A strategy that breaks one of them is not a candidate.

| Constraint | Source | Consequence for pricing |
|---|---|---|
| Core coordination is free forever for everyone in the circle; no paywall on knowing whether friends replied | Design manifesto §8; market research §4.3 G | Premium is automation and ongoing outcomes, never the plan itself |
| Invitees never pay, never install, never see a promotional stream | Brand research §3.2; manifesto §3.2 | Any charge lands on one person, not the group |
| No advertising against calendar or relationship data; no dark patterns, hostage data or hard cancellation | Manifesto §8; moats research §2.2 and §7 | Trust is the only P0 moat rated above 3/5; billing must not spend it |
| Groups meet monthly or slower, so a circle produces about twelve planning cycles a year | Moats research §5.3 | A monthly subscription charges for months the group did not meet; annual, per-circle or per-outcome pricing fits the rhythm |
| Willingness to pay is low to medium individually in the first segment; medium to high only for community organisers, hobby groups and sports teams | Market research §6 | The paying segments are the ones the MVP excludes; friend groups are the wedge, not the profit pool |
| The invitation-led growth loop depends on a guest starting a circle elsewhere | Moats research §5.1 and §6.3 | Never cap the number of free circles |
| Cadence must invite, never audit | Brand research §6.5 | No "stay on track" framing in the upgrade copy |
| The product is web-first | Spec §3; architecture §4 | A web checkout is natural and avoids the store commission for as long as the purchase is not offered inside the native app |

### 1.1 Cost to serve and the anchors

Serving a circle costs almost nothing, so a generous free tier is cheap. A handful of paying circles covers infrastructure.

| Item | Figure |
|---|---|
| Run-rate before native | US$19–44 per month ([technical architecture](../technical-architecture.md) §5.5) |
| Circles at A$49 per year that cover it | about 12–16 |
| TimeTree Premium, Australia | A$4.49 per month, A$42.99 per year |
| Cupla, per couple | US$4.99 per month, US$44.99 per year |
| Apple Invites | bundled into iCloud+; the host must subscribe, guests RSVP on the web |
| Apple App Store small-business commission | 15% for qualifying developers |
| Google Play, auto-renewing subscriptions | 15% |
| Freemium median download-to-paid at day 35 | 2.1% (RevenueCat 2026; mobile apps, not circles) |
| Monthly subscriptions remaining after one year, median | 8%; annual 28% (RevenueCat 2026) |

Howbout and TimeTree protect core planning in their free tiers and charge for personalisation and convenience. These are anchors for what the category tolerates, not proof of what a friend group will pay Wenna.

## 2. The candidate strategies

Each strategy names who pays, what for, a price anchor, why it fits and what breaks.

### 2.1 Circle supporter: one person pays, the whole circle benefits

The market research's own recommendation and the closest fit to the product.

- **Who pays:** one member of the circle, usually the organiser.
- **What for:** cadence automation that drafts the next plan when the circle is due; the on-device calendar overlay and clash greying; reminders tuned to the group; the circle's history and usual times; the take-turns rotation.
- **Free:** circles, plans, quiet asks, candidates, confirmation, the morning-after question, plan-update email, Continue as.
- **Anchor:** A$4.99 per month or A$39–49 per year per circle, annual shown first.
- **Why it fits:** charges the person receiving ongoing automation, not every invited member; matches Cupla's one-subscription-per-unit logic.
- **What breaks:** premium has to be automation the organiser feels, and most of it lives in Slices 2 and 3. Before then there is little to sell.

### 2.2 Organiser Plus: a personal subscription across all of someone's circles

- **Who pays:** the relationship organiser, who belongs to several groups and resents being the unpaid coordinator in each.
- **What for:** the same premium set as 2.1 in every circle they organise, plus a cross-circle view of what is due.
- **Anchor:** A$6–8 per month or A$59–69 per year.
- **Why it fits:** the moats research's bridge, where one trusted identity carries preferences into new circles.
- **What breaks:** paying individually to organise concentrates the labour the product wants to spread, and a paying organiser may expect control the circle model denies them.

### 2.3 Annual "keep this circle going", bought once a year at the moment it is felt

A variant of 2.1 that drops monthly entirely.

- **Who pays:** one member, after the second happened meetup, when the cadence nudge has just worked.
- **What for:** a year of the next one being easier: the premium set of 2.1.
- **Anchor:** A$49 per year, with a founder-era offer of free until a date and then the price.
- **Why it fits:** annual pricing matches a monthly meeting rhythm and avoids the dead-month cancellation that the subscription data shows for monthly plans; it is the cleanest willingness-to-pay test.
- **What breaks:** a larger first commitment at a point where the product has shown value twice, not twelve times.

### 2.4 Pay after it happened: a voluntary contribution at the morning-after moment

- **Who pays:** whoever wants to, when they tap "I was there". Nothing is withheld from anyone who declines.
- **What for:** nothing in particular; a one-off chip-in of A$5 or A$10, in the manner of Signal or Wikipedia.
- **Why it fits:** the most on-brand option available, because "make room for each other" is reciprocal and the ask lands where the value is felt. It can run before any premium feature exists.
- **What it is for:** evidence more than revenue. A completed payment at the value moment is the strongest willingness-to-pay signal the research says to collect, and it answers who pays: the organiser, a member, or nobody.
- **What breaks:** revenue is small and lumpy; it must not become a nag. One offer per happened meetup, dismissed in one tap, under the same caps as the conversion prompts in spec §5.11.

### 2.5 Organiser tier for groups that meet weekly

- **Who pays:** hobby groups, sports teams, book clubs, community organisers.
- **What for:** attendance insight, circles larger than the cap of twenty ([ADR 0012](../decisions/0012-circle-member-cap-of-twenty.md)), reusable audiences, recurring plans.
- **Anchor:** A$12–25 per month, which a weekly rhythm makes honest.
- **Why it fits:** the highest willingness to pay in the segment table, and a cadence that matches monthly billing.
- **What breaks:** it is a different emotional job, and the spec excludes community mode from the MVP. Treat it as expansion revenue once the friend-group loop is proven, not the first paywall.

### 2.6 Household and couples bundles, later

- **Who pays:** a couple or a household; parents maintaining friendships are a promising sub-segment.
- **What for:** one identity, one payment, several circles with a shared calendar overlay.
- **Anchor:** Cupla's US$4.99 per month per couple.
- **What breaks:** a different mode, and the brand research warns against "relationship app" framing early. Deferred for the same reasons as 2.5.

### 2.7 Rejected on the docs' own grounds

| Option | Why not |
|---|---|
| Advertising of any kind | Manifesto §8; it would spend the trust moat |
| Venue partnerships or a marketplace | A different business with its own cold start and safety model (moats research §7) |
| A per-plan charge on basic plans, or credits for them | Charges the core loop; the manifesto says core coordination is free forever |
| A cap on free circles | Breaks the invitation-led growth loop, where a guest who starts a circle elsewhere is the bridge between networks |
| A weekly plan | Attracts transient demand; 1.2% remain after a year in the subscription data |
| Anything that reveals who paid to the rest of the circle | Attendance and payment become judgement; brand research §3.4 |

## 3. How to test it

Keep the spec's position: no fake door. Run a real checkout on non-founder circles only, after two happened meetups, and measure checkout starts and completed purchases rather than stated intent (market research §12, phase 4).

| Step | Test | What it answers |
|---|---|---|
| Interviews, after two happened meetups | Who would pay, for what, and what price feels obvious and what feels too much | The payer role and the price range for 2.1 and 2.3 |
| First checkout, 2.4 | Morning-after contribution, one offer per happened meetup | Whether anyone pays at the value moment, and who |
| Second checkout, 2.3 | Annual circle supporter at A$49, free until a date | Whether automation is worth a year's commitment; payer identity: initiator, supporter for the group, or nobody |
| Branch, 2.5 | Organiser tier, only if friend groups love it but will not pay | The spec's decision tree for that branch |

Measure by circle, not by user: checkout starts and completions per activated circle, by payer role, and whether paid circles differ in second-plan rate and reported-happened rate from free ones. A paid circle that does not meet more often has bought nothing.

### 3.1 Where the checkout lives

The product is web-first and the organiser gate is a web screen, so the first checkout is a Stripe page on `wenna.app`, which keeps the whole price minus processing. Selling inside the native app requires the store's own purchase flow and commission; keep the offer out of the app until the test has an answer, and treat the native route as a later decision.

Prices are in Australian dollars because the seed is Melbourne. Show the full charge, the renewal period and the free-until date plainly, make cancellation one tap, and never delete a circle's history when a supporter lapses.

## 4. The honest caveat

At the freemium median conversion, a thousand activated circles paying A$49 a year is about A$2,500. Friend-group pricing covers the run-rate and proves willingness to pay; it does not fund growth. The organiser tier in 2.5 is where the revenue is most likely to be, and it waits on the friend-group loop being proven first.

## Sources

- [Market research: a social coordination app for real-world meetups](./meetup-market-research.md), §4.3 G, §6, §8 and §12
- [What makes a direct-to-consumer SaaS successful](./consumer-saas-success-research.md), §2.2 to §2.4
- [Software moats for consumer SaaS](./software-moats-research.md), §2.2, §5 and §7
- [Brand strategy and naming research](./branding-research.md), §3, §4 and §6.5
- [Design manifesto](../design-manifesto.md), §3.2 and §8
- [MVP product specification v2](../mvp-product-spec.md), §3, §5.11, §18 and §19
- [RevenueCat — State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps-2026-utilities)
- [TimeTree Premium pricing](https://support.timetreeapp.com/hc/en-us/articles/4647239978905-What-is-TimeTree-Premium)
- [Cupla pricing](https://cupla.app/blog/shared-google-calendar-vs-cupla-for-couples/)
- [Apple Invites announcement](https://www.apple.com/newsroom/2025/02/introducing-apple-invites-a-new-app-that-brings-people-together/)
- [Apple — App Store Small Business Program](https://developer.apple.com/app-store/small-business-program/)
- [Google Play — Service fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en-GB)
- [Apple — Auto-renewable subscription guidance](https://developer.apple.com/app-store/subscriptions/)

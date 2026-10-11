---
adr: 66
title: "The group sees who can make each option, and nobody sees anyone's whole availability"
status: proposed
date: 2026-10-11
builds_on: [45, 51]
---
# ADR 0066: The group sees who can make each option, and nobody sees anyone's whole availability

_Status: proposed · 11 October 2026 · amends spec §5.6 and §8.2 in wording only; builds on [ADR 0045](0045-the-editor-shows-what-others-have-said-as-counts.md) and [ADR 0051](0051-the-organiser-sets-the-final-plan.md)_

## Context

Three public sentences and the product disagreed.

- `/privacy` said: "Nobody in your circle sees your schedule, only which times work for the group."
- The marketing site said: "Nobody can open your reply. Nobody can see one person's schedule", and "No one is named for not replying."
- Spec §8.2 said: "Nobody's name is ever beside a time."

The option cards every member sees, not only the organiser, say "{name} can make it", "Doesn't work for {name}" and "{name} hasn't answered". The site's own mock said "Theo hasn't answered". Spec §5.6 already described the cards that way, so the spec disagreed with itself.

Two ways out were put to the founder. **A**: members keep seeing names on the cards, and the promises are rewritten to say so. **B**: only the organiser sees names, members see counts, and the database stops returning names to members. On 10 October 2026 the founder chose **A**: "Do option A where the group can see who can make each option, but make it clear that the group cannot see their entire availability."

## What a member can actually see

Checked in the code and the schema, not assumed.

1. **On the cards.** For each option on offer (at most three): who can make it, who answered but cannot, and who has not answered. That is a yes or a no for one stretch of time, never a window. Once options exist, the header marks who has replied.
2. **Across the cards.** Together the cards give a person's verdict on at most three suggested stretches, and the set changes as answers arrive. They do **not** show everything someone ticked: "can make it" means a window of theirs contains that stretch, or they said "I'm easy", and no card says what else they ticked. Somebody who watched the cards through a plan's life could collect several yes-or-no verdicts about a person on different stretches; that is the most it adds up to.
3. **In the availability editor.** Counts only: how many others could make each day, block and half hour. The editor's text names nobody (SUS-129, ADR 0045), and `others_availability` returns no name, no id and nothing linking one person's days. This was checked: the copy has no name placeholder, and the read's shape is pinned in a test.
4. **The one case that is not "counts".** ADR 0045 accepted that with exactly one other answer with times, the editor shows that person's windows, day by day, with no name. A reader who also knows, from the header marks, that only one person has answered can guess whose they are. So the public sentences promise what is always true, that nobody's whole availability is **shown with their name on it**, and do not promise that nobody could ever work it out. Raising that threshold would be a database change and is not done here.
5. **Beyond what the screens draw.** A signed-in member can also read, through the API, the rows the screens do not render: the near-miss options with who could make them, and each answer's kind (times, "I'm easy", none of these dates, more notice, not this time) once options exist. Never a window. Not changed here, because option B's database work is not being done; recorded so nobody reads the promises as stronger than they are.
6. **The organiser** sees more: who has answered at all before options exist, and by name who a stretch of their own choosing works for (ADR 0051). Members do not.

## Decision

**1. The cards keep their names.** Nothing about the cards changes. There are no viewer roles and no SQL changes.

**2. Every public sentence about who sees whose availability says two things plainly:** the group sees who can make each option (and who has not answered), and nobody sees anyone's calendar or whole availability with their name on it. The sentences, before and after:

| Where | Before | After |
|---|---|---|
| `/privacy`, your calendar | Nobody in your circle sees your schedule, only which times work for the group. | The group sees who can make each time we suggest. Nobody sees your calendar, and nobody is shown your whole availability with your name on it. |
| Site, promise 2 | Friends see the result, not your answer. Your days and times go in, a combined picture comes out. Nobody can open your reply. Nobody can see one person's schedule. | Friends see who can make a time, not your calendar. Your days and times go in. What comes out is who can make each suggested time. Nobody can open your reply, and nobody is shown your whole availability with your name on it. |
| Site, promise 3 | No one is named for not replying. A plan that doesn't get there just fades. We say "not enough people were free this time", never who. | Nobody is called out for not replying. Until you've answered, the options say so in one quiet line, and the whole group can read it. If a plan doesn't get there it just fades, and the message names no one. |
| Site, caption under the mock's answer screen | Your friends only see the combined result, never this screen. | Your friends see who can make a time, never your calendar or this screen. |
| Answering screen notice | Your friends will only see a combined result. They won't see your calendar or a personal schedule view. | Your friends will see who can make each suggested time. They won't see your calendar, or your whole availability with your name on it. |
| Join page notice | No account or app needed. Your friends only ever see a combined result, never your calendar. | No account or app needed. Your friends see who can make each time, never your calendar. |
| Spec §8.2 | Nobody's name is ever beside a time. | Nobody's name is ever beside a window of times. The cards name who can make each option on offer, who cannot and who has not answered; they show no window. |

The site's mock ("Theo hasn't answered") already matched the new promise and is unchanged. Settings, privacy ("They see which options work for you, never a personal schedule") and the name screen ("what the others will see next to your times") were honest and are unchanged.

**3. The manifesto's list of what is never shipped** read "the identity of someone who didn't reply". Read against the manifesto's own test for the cards (§3.4: from a card alone, who is coming, who is not and who we are waiting on), that means no shaming: no count of the slow, no read receipts, no names in a reminder to the group or in the message that a plan faded. §8 now says so.

**4. The rule lives in the domain** (non-negotiable 2). `answerVisibility` in `packages/domain/src/scheduling/visibility.ts` says what the cards name and what the editor shows; `promiseProblems` checks the real copy against it. The app's copy test feeds it the card templates, the editor's lines and every public sentence above, and fails if they disagree in either direction: cards changed to hide names while a promise still says the group sees them, or a promise rewritten to say names are hidden while the cards show them.

## Alternatives considered

**B: names for the organiser only.** Members would see counts ("3 can make it, 1 can't, 2 still to answer"). It makes the old promises true, but it takes away the thing the manifesto tests the cards by, and `MemberView`, `cards.ts`, `others_availability` and `response_summaries` would all change, with pgTAP for the deny. The founder chose against it.

**Keep the wording and add a footnote.** A promise that needs a footnote to be true is not plain.

## Consequences

- The three promises are true of the product, and a test keeps them so.
- Spec §5.6 and §8.2 now say the same thing, and the manifesto's §8 agrees with both.
- The single-answer case in point 4 and the extra rows in point 5 are written down, not fixed. If the founder wants either closed, that is a new ticket with a database change.
- The artboards for the answering screen and the join page change with their sentences, through `docs/design/gen.py`.

---
adr: 54
title: "The link preview may say a plan is locked in, as one of two words next to the name"
status: proposed
date: 2026-10-03
amends: [43]
---
# ADR 0054: The link preview may say a plan is locked in, as one of two words next to the name

_Status: proposed · 3 October 2026 · amends [ADR 0043](0043-the-product-is-wenna-and-confirmations-sign-off-with-the-day.md) (the link preview's wording) and architecture §9.4 ("circle name only")_

## Context

`public.preview_for_code` answers a stranger with no session, a chat app drawing
a card, and until now it answered one `text`: the circle's name. Its comment and
architecture §9.4 made that the point ("no field anything else could be added
to"), and `ogTitle` / `ogDescription` in the domain carry the same rule in their
signatures.

One card for every link is a bug the founder found on 3 October 2026. He locked
in a plan and pasted the share message, "Locked in: Boo, Sat 3 Oct, 5:30-7:30 pm
at District Docklands. Details and add-to-calendar: …/p/tce4cdsy", and the card
above it read "Boo is finding a time to catch up". Every organiser sees that
card at the moment the plan is set. Two more links draw a card that is untrue
for the same reason: a cancelled plan's "Update: … is off" message links
`/p/<code>`, which no longer resolves, and gets "A circle is finding a time to
catch up"; and a circle invite (`/join#…`) gets the same, when no plan exists
yet.

Choosing the card by link kind alone cannot fix the first: `/p/<code>` is the
same link whether the plan is still collecting answers or is confirmed, and only
the database knows which.

## Decision

**1. The lookup answers a closed enum of plan state next to the name.**
`preview_for_code` returns at most one row of `(circle_name text, plan_state
public.preview_plan_state)`, where `preview_plan_state` is a Postgres enum with
exactly two values:

| `plan_state` | When |
|---|---|
| `asking` | the code is live (ADR 0049) and the plan is `collecting` or `ready` |
| `locked_in` | the code is live and the plan is `confirmed` or `completed` (ADR 0049's rule already requires a confirmation that has not been cancelled, and a meetup that ended less than fourteen days ago) |

Nothing else: no date, no time, no place, no member, no free text. An enum rather
than a `text` column so that the type is the rule: a third word needs a migration
and an ADR, not a `case` branch somebody added late.

**2. Null keeps exactly the meaning it has today.** The function returns **no
row** wherever it returned null before: `/join`, a malformed code, an unknown
code, a cancelled or expired plan, a plan whose meetup is more than fourteen days
past, an archived circle. These are all decided by the same
`private.circles_open_to_continue_as` as before, and a caller still cannot tell
one from another. The Continue-as screen, which reads "no row" as "this link isn't
active", is unchanged in behaviour; the client helper that asks for it turns an
empty answer into the `null` it always held (`reattach.ts`).

**3. What the card may say.** Four cards, chosen by the pair (link kind, state)
and nothing else:

| Link | Answer | Title | Description |
|---|---|---|---|
| `/p/` or `/j/` | `asking` | "{circle} is finding a time to catch up" | unchanged |
| `/p/` or `/j/` | `locked_in` | "{circle} is locked in" | "The day, the time, the place, and add to calendar." |
| `/p/` or `/j/` | no row | "Plans with friends, on {brand}" | wording true of any link |
| `/join` | never resolved | "You're invited to a circle on {brand}" | wording true of any invite |

A plan that is not confirmed (cancelled, or revised back to asking) never says
"locked in": a cancelled plan resolves to no row and draws the generic card, a
revised one is `asking` again. The card does not reveal state beyond "locked in".
The wording is the founder's to approve in review; the strings live in the
domain's templates.

**4. The grant does not move.** `preview_for_code` stays granted to `anon`,
`authenticated` and `service_role`, and the return is still the circle's name and
one of two words. The signature that enforces §5.2 is the domain's: a title takes
the circle name, a description takes nothing, and the card is chosen by the enum.
No date or place is in scope for a template to print.

## Alternatives considered

- **Choose the card by link kind alone.** Rejected: it cannot tell a confirmed
  plan from one still collecting answers.
- **A second function for `/p/` that answers only for a confirmed plan.** Keeps
  one `text` per function, but duplicates the liveness rule, and
  `preview_for_code`'s null already means "this link isn't active" to the
  Continue-as screen, so that must not change either way.
- **Return `jsonb` or a free-text "state".** Rejected: the closed enum is the
  guard.
- **Say the plan is cancelled on the card for a cancelled plan's link.** Rejected:
  it would reveal state beyond "locked in" to anybody holding the link, and the
  function's answer for a link that is not live is the same one a code that never
  existed gets, by design (ADR 0049).

## Consequences

- One migration (`0037`, ADR 0015) drops and recreates `preview_for_code` with
  the new return type, and adds the enum.
- `PreviewTemplates` keeps its shape and `EN_PREVIEW_TEMPLATES` keeps meaning the
  asking card, so the landing page's hero (which renders it) is not affected; the
  new cards are additional exports.
- Architecture §9.4 and the function's comment say "name and one of two words".
- The plan-shared screen's in-app preview mock is the same template as the real
  card for a confirmed plan.

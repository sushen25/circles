# ADR 00XX: A circle has one open plan at a time

_Status: accepted · 24 September 2026_

## Context

Reviewing S1-26 (SUS-42), the founder opened plan setup in a circle whose plan
was already finding a time and tapped **Ask the group**. A second plan was
made. Circle home showed it — `findingPlanOf` takes the newest answerable plan
— and the first dropped out of view while it kept running: its link still
admitted people and took answers, its deadline still closed, its options-ready
and reminder emails still sent, and it could still be confirmed from its own
candidates URL. Nothing told the members who had answered it.

Nothing stopped this. `public.create_plan` checked the circle was active and
the deadline was ahead, and no constraint limited a circle to one plan in
`collecting` or `ready`. The spec assumed one at a time without saying so:
§5.2's circle home has one "finding a time" card, §5.3's **Plan a catch-up**
had no rule for a circle that already is, and the quiet ask (§5.4) has a cap
where the open plan had none.

SUS-89 put three options to the founder: enforce one open plan per circle;
let a new plan cancel the old one out loud; or allow several plans per circle
and teach every screen about them.

## Decision

**A circle has at most one plan that is `collecting` or `ready`.**

- The rule is a transition guard (AGENTS.md §6.4): `no_open_plan` is on
  every row of `packages/domain`'s table that enters `collecting` or `ready`
  from outside them — `draft → create_named`, `seeking → threshold_reached`,
  `confirmed → reopen` — and on `draft → create_quiet`, and on none of the
  rows between the two open states, which are the one open plan changing
  shape. `planning.transition_plan` enforces it under the circle's row lock,
  so two arriving together are decided one after the other, refusing with
  `plan_in_progress`. `public.create_plan` reaches it the way it reaches
  every guard; the draft it inserted rolls back with the refusal. "Change the
  time" on a locked-in plan meets the same refusal while a newer plan is
  finding a time (the review's case: without it, a reopen made two).
  `plan_in_progress` is a `ProblemReason` (409).
- The domain carries the same guard: `canTransition` takes
  `circleHasOpenPlan`, and fails closed when it is not said.
- **Plan setup shows the running plan instead of a form.** Reached with a plan
  already finding a time — from circle home's **Plan a catch-up**, from
  `/circles/[id]/plan/setup` or `/plan/window` directly, or from the first-run
  card at `/plan/new` — the screen names the plan, when its replies close and
  how many have answered, and offers what the reader may do: **Edit the plan**
  to its organiser, **Cancel the plan** to the organiser or the circle's owner
  (spec §4.5), and **See how it's looking** to everyone; a member who is
  neither is told who is organising it. Both actions are S1-26's screens. The
  second "Ask the group" never happens silently; if two taps race, the loser
  is told the same thing and the screen re-reads the circle.
- **A quiet ask follows the same rule.** `create_quiet` carries the guard, so
  a quiet ask cannot be started beside a plan already asking; `threshold_reached`
  carries it, so an ask at its threshold does not open beside one either — it
  stays `seeking`, refused by name; and a named plan cannot be started beside
  an ask that has opened (which is `collecting`). A quiet ask still `seeking`
  is not an open plan: it is nobody's "finding a time" until it opens, so a
  named plan may be started beside it. What the quiet ask's own function does
  with the refusal — wait for the next keen answer, expire, tell the initiator
  — is Slice 2's to decide (S2-01, S2-02) and is written on those tickets.

Spec §5.3 says the rule in one sentence.

## Alternatives considered

- **Raising a new plan cancels the old one, out loud.** Honest, and the
  cancelled email and screens already exist — but it builds a second way to
  cancel a plan, on the setup screen, and it makes "Plan a catch-up" a
  destructive action in a circle that already has one. Edit and Cancel are one
  tap away on the screen that now appears; the organiser who really wants to
  start again cancels first, and everybody who answered is told.
- **Several plans per circle.** Circle home, the circles list's state line,
  the outcome report and the cadence rules (S2-04) would all need a definition
  of "the next one", and the product's premise is a group agreeing on one
  time. Nothing asked for it.
- **A partial unique index on `plans (circle_id) where state in
  ('collecting', 'ready')`.** Structural, which is attractive — but the seed
  and the tests write plans around the machine on purpose, and an index
  applied to a database already holding two open plans in a circle fails
  with a constraint name where a person needs to be told what to do. The
  guard says the rule where a plan enters the open states, which is every
  place a second one can, and the migration says the rest in words.
- **A check in `create_plan` alone.** It would hold for the client's path and
  not for the quiet ask's, and it would be the second copy of a rule the
  state machine can hold once.

## Consequences

- Migration 0024 reseeds `planning.transitions` with the guard on the four
  rows and carries the changed `transition_plan` and `create_plan`.
  `MIGRATION` in `scripts/gen-transitions.mjs` and
  `scripts/gen-sql-functions.mjs` now points at it.
- **The migration refuses to apply where a circle already holds two open
  plans**, by count, and says what to do: cancel the older plan from the app,
  so the people who answered it are told, then apply again. It rewrites no
  row and chooses nothing; a plan is cancelled only by a person deciding to.
  It holds plan writers out for the length of its transaction (a table lock
  that conflicts with every insert and update on `plans`, not with reads), so
  no plan can land between the count and the new rows. Check dev and prod
  with the query in the migration before deploying.
- pgTAP: a second `create_plan` beside an open plan throws `plan_in_progress`
  and leaves nothing behind; a `create_quiet`, a `reopen` and a
  `threshold_reached` beside one do too; a cancelled plan frees the circle.
  Tests that made several plans in one circle to prove something about
  creation now put each away first, through the machine, and the transitions
  that have to enter `collecting` run in circles of their own.
- `findingPlanOf` picks one plan rather than the newest of several.
- The live suite has a spec for the second attempt
  (`tests/e2e-live/second-plan.spec.ts`).

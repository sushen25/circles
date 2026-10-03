# ADR 00YY: The first run drafts the circle and plan with no account; the saved-place gate moves to before the share

_Status: proposed · 3 October 2026 · amends spec §5.1, §6.1, §11.2 and §11.3; narrows [ADR 0004](0004-organiser-requires-permanent-identity.md) on _when_ the gate is shown, not on what it protects; builds on [ADR 0026](0026-first-run-shares-a-plan-and-a-defaulted-quorum-follows-the-circle.md)_

## Context

The first run asks an organiser to sign in before they have seen anything. Spec
§5.1 has Welcome and the email code as steps 1 and 2; ADR 0026 made the rest of
the run plan-first but left sign-in where it was. For somebody who has come from
the website's **Start a plan**, that is a wall in front of the thing they came
for: a stranger asks for an email address before the product has done anything.

The founder decided on 3 October 2026: **no sign-in before value, for the
organiser either.** The organiser names the circle and accepts or adjusts the
plan with no account. The gate comes _after_ the plan is ready and _before_ it
is shared, worded as a practical need ("so it's yours on any device").

[ADR 0004](0004-organiser-requires-permanent-identity.md) is why there is a gate
at all. A lost anonymous session strands a plan at its most important moment,
because nobody could confirm it, and the privacy invariant (spec §8.2, AGENTS.md)
is that **organiser roles belong to saved-place identities only**. That reason is
about what exists on the server and who owns it. It says nothing about whether a
person may _type a circle's name_ before signing in. The two can come apart if
nothing is created on the server until the place is saved.

**Does a drafts store exist already?** SUS-92 adds one, but it is not on `main`:
PR #95 is still open. And what that PR keeps in MMKV is an _answer_ to a plan
(painted times, "I'm easy", a pending send), keyed by person and plan. On `main`
the nearest thing is `data/availability/drafts.ts`, which is the same idea for
availability and is keyed that way. Neither is a place to hold a circle and a
plan that have no id yet and belong to nobody. This ADR builds the smallest store
the ticket needs and says what it will give way to.

## Decision

**1. The first-run order is** First circle → First plan → **Save your place** →
Your name → Paste to chat → Add my times → circle home, finding a time. "Step 1
of 2" and "2 of 2" stay on the circle and the plan; Save is unnumbered, because
it is not a step in making the plan. A signed-in organiser (an account with a
name) goes First circle → First plan → Paste to chat with no gate and no Your
name.

**2. Nothing is created on the server until the place is saved.** The circle's
name, its cadence and the plan's preset are held **on the device**. `create-circle`
and `create-plan` are called, in that order, once the sign-in has completed and
the organiser has a name. They are unchanged: `create-circle` still refuses an
anonymous session, and `create-plan` still needs a member who can organise. So
ADR 0004's invariant stands exactly as written; what moves is where in the
journey its screen appears. **Abandoning at the gate creates nothing**: not a
circle, not a plan, not an anonymous user.

**3. The draft is one record in the session storage adapter** (`data/auth/storage`:
`localStorage` on the web, the chunked secure store on native), under one key. It
holds the circle's name and cadence, the plan's preset, the organiser's chosen
way on (ask the group, just invite, or see if people are keen), and two
idempotency keys. It **survives a reload and the round trip to an email code or
an OAuth provider**, because it is written as it is typed and read when each
screen mounts. It **expires 24 hours after it was last changed**: a read past that
removes it and answers "no draft". Keeping the keys in it means a finish that was
interrupted after the circle was made, and runs again, returns the same circle
and the same plan instead of a second one (ADR 0016).

When SUS-92's MMKV store reaches `main`, this record moves into it with no change
to what it holds; the draft's reads and writes are four functions in one file.

**4. The gate is one screen, "Save your place".** It says "Your plan's ready" and
summarises the drafted plan so that nothing feels lost. The email code is
primary. Apple and Google stay hidden until SUS-77 gives them somewhere to go. The
terms line is unchanged: no ads, no selling data, 18+. A guest who already belongs
to a circle saves their place by the route that carries their membership with them
(ADR 0004, S2-07), as on the sign-in screen today.

**5. "See if people are keen instead" and "Just invite people for now" reach the
same gate**, with that choice held in the draft, and after it the circle is made
and the organiser goes where they chose. Making a circle for these paths makes no
plan, so nothing is asked of the group by accident.

**6. Entry.** `/` for somebody with no saved place and `/circles/new` for anybody
are the first circle. A quiet "Sign in" in the top bar serves the returning
organiser, who goes to `/sign-in` exactly as before. A signed-in account that opens
`/` still goes to its newest circle, as before. The paths the website links to need
no change.

**7. Three analytics events**, `organiser_draft_started`, `organiser_gate_shown`
and `organiser_gate_passed`, carry **no payload at all**: nothing about the circle,
the plan or the person. The funnel V3 needs (spec §11.2) reads off them: started,
reached the gate, passed it.

**8. Out of this decision.** A guest member who plans in a circle they already
belong to is not a first run: there is a circle on the server, so the gate stays in
front of `create-plan` as it is (S2-07). Guests who respond are unchanged: responding
never requires a saved place.

## Alternatives considered

- **An anonymous session that owns a draft circle on the server.** Rejects
  itself: it needs the restrictive policies of ADR 0004 loosened for the very
  tables they protect, it leaves rows owned by identities nobody can reach, and
  it makes "abandoning creates nothing" false.
- **A server-side draft table keyed by a device token.** A new table, a new write
  path open to anyone, and a retention rule, to hold two short strings that are
  safe on the device. If drafts need to follow a person across devices, that is a
  later decision, and the person would by then have a saved place.
- **Keep sign-in first (ADR 0026 as it was).** The founder's reading is that the
  ask before the value is the cost; it is also what the funnel cannot tell us.
- **Keep the draft in memory only.** Fails the reload and the OAuth round trip,
  which are the two ways a person leaves and comes back during sign-in.

## Consequences

- Spec §5.1 first-run steps and the "organiser gate" paragraph, §6.1, §7's page 0
  row and §11.3 change in the same PR, and so do the artboards, through
  `docs/design/gen.py`: First circle and First plan gain the top-bar changes, and
  **Save your place** is a new artboard. The Welcome artboard leaves the first-run
  page, since nothing draws it any more.
- A draft lives on one device for a day. Somebody who starts on their phone and
  signs in on their laptop starts again; the gate's own copy says the place, not
  the draft, is what follows them.
- A shared browser can show the next person a circle name the first typed. The
  draft is cleared when a circle is made from it and when somebody signs out, and
  it holds nothing but that name, a cadence and a preset.
- The draft is never sent anywhere before the place is saved, and never to
  analytics at any time.
- The first-run tests that began with "Continue with email" on `/` begin at
  `/sign-in` instead.
- SUS-77 gives the Save screen its Apple and Google buttons without a change here.

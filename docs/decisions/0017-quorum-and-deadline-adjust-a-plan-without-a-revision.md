# ADR 0017: Changing a quorum or a deadline adjusts a plan; it does not revise it

_Status: accepted · Date: 14 September 2026_

## Context

Architecture §9.1 described `revise-plan` as "Edits window/duration/quorum/deadline
→ new revision; invalidates responses". The state machine agreed: `edit` was the
only way to change any of those, and it carries `bumpsRevision: true`.

Responses are keyed by `(plan_id, revision, user_id)`, so a new revision does not
merely mark the old answers stale — it orphans them. Every member has to answer
again.

Spec §5.3 draws a different line, and draws it explicitly: an edit that
invalidates responses "shows, before saving, exactly who will be asked again",
and the domain's own `invalidatingChanges` lists what invalidates — the window,
the daily band, the duration. Its comment says why: "Quorum and deadline change
what happens to the answers, not the question, so they cost nobody a second
reply."

So the architecture and the spec disagreed, and until S1-15 nothing exercised the
disagreement: no code called `edit`. The first organiser to nudge a quorum from
four to five would have watched five answers vanish, with no warning that
mentioned it, because the warning is computed from `invalidatingChanges` and
`invalidatingChanges` says a quorum change costs nobody anything.

## Decision

**`adjust` is a transition of its own**, from `collecting` and from `ready`, for
the quorum and the response deadline alone. It does not bump the revision, so the
answers stay the answers. It emits `planning.plan_revised`, as `edit` does: what
the circle is told is that the plan changed, and whether that cost anybody a
reply is the *absence* of a re-ask rather than a different name.

`planning.allowed_keys('adjust')` is `quorum` and `response_deadline` and nothing
else, which makes the split structural: a window cannot ride along on an
adjustment. `public.revise_plan` derives which action a request is from what it
is actually changing, so a caller cannot ask for the cheap action and the
expensive change.

Architecture §9.1 is corrected to describe both.

**A quorum change stales the candidate set.** `planning.candidate_is_eligible`
checks the set's versions and the near-miss flag and never reads the plan's
quorum, so a four-person candidate stayed confirmable after the quorum went to
five. An adjustment that changes the quorum bumps `input_version` and, on a plan
that was `ready`, returns it to `collecting` through the existing
`candidates_gone` — the action that already means "the set is stale, a
recalculation follows", and that already announces nothing.

A deadline change touches neither, and leaves a `ready` plan ready.

## Alternatives considered

- **Leave `edit` as the only path and accept the re-ask.** Rejected: it
  contradicts the spec, and silently. An organiser correcting a typo in a number
  would be told nothing and would cost five people a second reply.
- **Keep one action and bump the revision conditionally on the payload.**
  Rejected: `bumps_revision` is a column on `planning.transitions`, generated
  from the domain, and making it depend on the payload would make the generated
  table stop describing what happens. The split reads better as two actions,
  which is also what lets `allowed_keys` enforce it.
- **Let the client say which action it wants.** Rejected: then "cheap action,
  expensive change" is a request somebody can make. It would not get far —
  `allowed_keys` refuses the shape — but a caller having no say is simpler than a
  caller being caught.
- **Send a quorum change to `collecting` unconditionally.** Rejected for
  deadline-only adjustments, which stale nothing: dropping a `ready` plan to
  `collecting` and waiting for the engine to put it back is churn the person
  watching the screen would see.

## Consequences

- `planning.transitions` grows two rows; `0011_plan_lifecycle.sql` reseeds the
  table, since 0003 has shipped.
- The re-ask warning is now honest for every kind of edit, because the thing it
  is computed from and the thing that happens are the same thing.
- A quorum change on a `ready` plan puts it back to `collecting` until the engine
  recalculates (S1-16). Until that lands, such a plan sits in `collecting` with a
  stale set — which is the same state a withdrawn response leaves it in, and is
  handled by the same recalculation.
- `revise-plan` returns `bumps_revision`, so a client can word the confirmation
  differently for the two cases without knowing which action was chosen.

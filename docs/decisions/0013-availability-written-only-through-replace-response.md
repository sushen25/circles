# ADR 0013: A member's availability is written only through `replace_response`

_Status: accepted · Date: 10 September 2026_

## Context

Architecture §8.4 said: "Writes: members may `insert/update` only their own
`plan_responses`, `willing_windows`, … All other writes go through functions."
Read literally, that is direct table writes under RLS for a response and its
windows — and S1-09's ticket asked for both that *and* a `replace_response`
RPC, "so the client never does multi-statement writes".

A response and its windows are one answer and several rows. Written directly,
they are several statements: a reader between the delete of the old windows
and the insert of the new ones sees an answer with no windows, the
`input_version` bump fires once per row rather than once per answer, and the
outbox event that tells the dispatcher to recalculate has nowhere to fire from
at all — a trigger cannot write an event for a write that has not finished.
Two write paths to the same rows is also two places the rules have to agree.

## Decision

**`public.replace_response(plan_id, status, windows, used_calendar_overlay)`
is the only way a member's answer is written.** No client role holds `insert`,
`update` or `delete` on `plan_responses` or `willing_windows`. The function
runs under the plan's row lock, replaces the response and every window in one
transaction, and is where the outbox event goes.

The "only their own" half of §8.4 is unchanged and now lives in the function:
the caller's `auth.uid()` is the only user it will write for.

## Alternatives considered

- **Direct RLS writes, as §8.4 said.** Rejected for the reasons above; it was
  the ticket's own item 5 that named the problem.
- **Both paths, with the trigger doing the bookkeeping.** Rejected: the outbox
  event still has nowhere to fire from on a direct write, and a rule enforced in
  two places is a rule that will diverge.

## Consequences

- Architecture §8.4's write sentence is amended: responses and windows are
  written through `replace_response`; attendance, nudge state and profile
  columns remain direct.
- `input_version` is still bumped by a trigger on both tables rather than by
  the function, so the invariant holds for every write path there will ever
  be — including a retention job or a migration.
- The client submits one JSON array of windows and receives one response row.
  Drafts that survive going offline (spec §5.5) are the client's to keep; the
  server only ever sees a complete answer.

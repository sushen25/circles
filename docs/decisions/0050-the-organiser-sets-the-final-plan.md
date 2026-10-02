# ADR 0050: The organiser sets the final plan: any day and time, edited afterwards without asking everyone again

_Status: proposed · 2 October 2026 · amends spec §5.6, §5.7, §5.8 and §8.2; builds on [ADR 0017](0017-quorum-and-deadline-adjust-a-plan-without-a-revision.md), [ADR 0018](0018-the-recalculation-runs-in-the-request-that-caused-it.md) and [ADR 0046](0046-an-edit-that-clears-answers-asks-those-people-again.md)_

## Context

The organiser could lock in only one of the options the engine offers: at most
three, each meeting the plan's number. With none they could lower the number,
widen the dates or close the attempt. Once a time was locked in, "Change the
time" threw it away and asked everyone again, and the place and note could not
be edited at all. That leaves the person running the plan unable to do the
ordinary thing: "we're doing Friday at 7, come if you can", "the table moved to
7:30", "it's at Naked for Satan now".

The founder reviewed an interactive mockup on 2 October 2026 and approved a
direction: **the organiser has the freedom to set the final plan**, including a
time that conflicts with what people put down, and to edit it afterwards. The
freedom comes with one rule from the manifesto (§3.4, "never hide the maths"):
**the override is never silent.** Before locking anything in, the organiser sees
by name who the time works for and who it does not, and is told plainly when it
is below the plan's number or on a day nobody was asked about. Then it is their
call.

Spec §8.2 says a confirmed time never changes as a side effect of later
responses. That stands, and this ADR reads it closely: **the organiser changing
a confirmed time on purpose is not a side effect of a later response.** What is
refused is an answer, an engine run or a recalculation moving a time nobody
chose to move. An answer that arrives after lock-in still changes nothing.

## Decision

**1. An organiser's own time is outside eligibility.** Spec §5.6's definitions
of available and eligible are unchanged and so is the engine's ranking. A stretch
the organiser sets is a confirmation of a time that is not in any candidate set,
and the confirmation records that: `own_time`. The organiser may do this from
`collecting` (which includes "no quorum", "replies closed" and the waiting
screen, before any option exists) as well as from `ready`; the plan's number is
**not changed** by it. If the available count is below the number the
confirmation records `below_quorum`, and nothing else moves.

**2. What a valid own time is.** It starts in the future; both ends are on a half
hour in the plan's zone; it ends after it starts; it lasts from 30 minutes to 5
hours; and it starts no later than the end of the plan's last day plus 30 days.
Any future day inside that is allowed, including a day the plan never asked
about, and the picker says so. The rule is one pure function in the domain
(`validOwnTime`), and `private.is_valid_own_time` mirrors it in SQL, refusing in
the database as well as on the screen.

**3. Who can make this stretch is one rule.** The engine's own test (a window that
fully contains the stretch, or "I'm easy") is extracted as `whoCanMake` and the
engine calls it for every candidate. The picker, the review screen and the
server read the same answer: `private.stretch_availability` mirrors it in SQL,
under the same members-list order, and a test holds the two to the same cases.
The organiser reads it by name through `public.stretch_availability(plan, start,
end)`, granted to the plan's organiser alone. It returns who can make the stretch,
who answered otherwise and who has not answered, which is what the candidate
cards already show for an option; it returns no windows.

**4. Who is going, once it is locked in.** Nobody re-confirms what their answer
already said.

| Case | Going | Everybody else |
|---|---|---|
| One of the offered options | times cover it, or "I'm easy" | answered otherwise: can't make it; never answered: to confirm (as today) |
| A time the organiser set themselves | times cover it, or "I'm easy" | **to confirm**, whether they answered or not |
| A move | derived again from this revision's answers by the own-time rule; whoever's times cover the new one is going with nothing to do | to confirm; a status somebody set by hand for the old time does not carry over |
| A place or note edit | nobody's status changes | nobody's status changes |

"Can't make it" is never put in somebody's mouth by an own time: they never said
no to a time the organiser chose knowing the answers (manifesto §3.5). **The
organiser's own status follows their own answer** by the same rules, not
"always going": if their times do not cover it they are to confirm, with the same
two buttons. The review screen and the who-it-works-for line include them by that
rule.

**5. The state machine.** `confirm_own` is `collecting`/`ready` to `confirmed`,
guarded by `organiser` and by the time being valid, not by `candidate`. A confirmed
plan stays confirmed through two more actions, both guarded by `organiser`:
`move_confirmed` (a new valid time) and `edit_confirmed` (place or note). Neither
bumps the revision: a move is not "Ask for new times" (the old `reopen`, renamed in
the screens because it now has siblings), which still opens a new revision and
asks everyone. Editing a plan whose time has ended is out of scope and refused.

**6. A move supersedes; a place or note edit updates in place.** A move marks the
active confirmation `superseded` with its own reason, `move`, and writes a new
active one in the same revision, in the same transaction, so "Friday was moved"
stays true in the record and a revision still has at most one active confirmation.
The new row records where it moved from. Attendance is derived again for the new
row and the old rows stay as history. A place or note edit updates the active row
and writes nothing else. The calendar entry follows a move: the new confirmation
keeps the old one's calendar UID and carries a higher sequence, so a calendar
moves its entry rather than doubling it.

**7. The available set is frozen honestly.** A candidate lock-in sends
`expected_set_id`, as before (ADR 0018). An own time has no set to name, so it
names the plan's `input_version` and revision as the screen read them. If anybody
answered while the organiser was looking, the plan has moved on, the request is
refused as `stale_availability`, and the screen updates its names and asks again
rather than freezing a list nobody saw. A move does the same; a place or note
edit does not need it.

**8. Telling people.** A moved time is an important change. It is a new kind,
`moved`, to the plan's members, push first and email on a verified subscription, and
it is **not held by quiet hours**, like `locked_in` and `cancelled`: a time that
moved is news you need before you leave the house. It supersedes the old
confirmation's letters: the reminder and the morning-after letters queued for the
old time are skipped, and new ones are queued for the new, so a person is told
once and reminded once. A place or note edit **emails nobody**: the confirmation
updates in place and everyone sees it straight away, which the screen says. A
paste-ready message for a moved time sits beside "locked in" and "changed"
(`changed` means "new times, please" and stays for asking again).

**9. Analytics, counts and booleans only.** `meetup_confirmed` gains `own_time` and
`below_quorum`. A move is `meetup_moved` (`attending_count`, `invited_count`) and
a place or note edit is `confirmation_edited`. No names, places or notes.

**10. After a hand-off** the new organiser has the same freedom: nothing here is
tied to whoever created the plan.

## Alternatives considered

- **The organiser is always going.** The ticket's first recommendation, and
  rejected by the founder: it would put somebody on the going list on the strength
  of nothing they said.
- **"Can't make it" for everyone an own time does not cover.** Rejected: it puts
  words in people's mouths. They never answered this time.
- **A move opens a new revision and asks again.** That is "Ask for new times", which
  stays. A move is the organiser saying "it's now Saturday, come if you can", and
  anyone whose times already cover it should not be asked anything.
- **Lowering the number when locking in below it.** Rejected: nothing is lowered
  silently, and the picker and the review each say it before it happens. The
  confirmation records `below_quorum` instead.
- **Emailing a place or note edit.** Rejected for now: the change is visible
  straight away, and the people it matters most to, those who are going, are
  told if the time moves. The spec's "time or place materially changed" is read
  as a time change until somebody asks for the other.
- **A second rule for the picker's names.** Rejected: two rules drift. One pure
  function, called by the engine, the picker and (in SQL) the server.
- **Limiting an own time to the plan's days.** Rejected: "we're doing Friday at 7"
  is often a day nobody was asked about. The picker says so and the limit is 30 days
  past the plan's last day.

## Consequences

- Spec §5.6 says an organiser's own time is outside eligibility; §5.7 replaces
  "may confirm any eligible candidate", says what the three actions on a locked-in
  plan are and renames "Change the time"; §5.8 adds the moved letter and its
  quiet-hours exception; §8.2 says an organiser changing a time on purpose is
  not a side effect of a response.
- Migration 0035: columns on `meetup_confirmations` (`own_time`, `below_quorum`,
  `moved_from_starts_at`, `moved_from_ends_at`, `calendar_uid`, `calendar_sequence`),
  the reason `move`, three transitions, one outbox event
  (`confirmation.meetup_moved`), and the functions named above.
- The organiser can learn, by trying times, which members could make which stretch
  of time, which is more than three candidate cards show. Candidate cards have always
  put names beside a time (spec §5.6); this does the same for any stretch the
  organiser tries, and the picker returns who can make it and who cannot, never the
  windows somebody gave. §8.2's line about what the editor shows other members is
  about a different screen and stands. The organiser's wider view is accepted, and
  is the price of "you'll see who it works for".
- "Ask for new times" and "Cancel this plan" are unchanged apart from the first's
  name.

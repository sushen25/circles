# features

One folder per bounded context. A route renders exactly one feature screen and
passes params; the screen owns the composition (architecture §7.5). **Keep this
table current in the PR that changes a screen** — it is the map between the
canvas, the app and the ticket that owns each.

Every screen takes the same props: a `fixture` (Slice 1 replaces it with real
data), an optional `state` from the eight in `src/features/state.ts`, and
`onNext`/`onBack`. The states a screen can actually be in are visible in the
gallery at `/gallery`.

Screens were scaffolded from the artboards by `scripts/scaffold-screens.mjs`,
then edited. **That script will not overwrite an existing screen** — once a
screen has been touched, this file and the code are the authority, not the
artboard.

73 screens across 9 contexts.

### availability

| Artboard                        | Route                       | Component                   |
| ------------------------------- | --------------------------- | --------------------------- |
| `Availability.dc.html`          | `/j/[code]`                 | `AvailabilityScreen`        |
| `AvailabilityPicking.dc.html`   | `/j/[code]` (days ticked)   | `AvailabilityScreen`        |
| `AvailabilityAdjusting.dc.html` | `/j/[code]` (a day open)    | `AvailabilityScreen`        |
| `AvailabilityOverlay.dc.html`   | `/j/[code]/overlay`         | `AvailabilityOverlayScreen` |
| `CalendarDenied.dc.html`        | `/j/[code]/calendar/denied` | `CalendarDeniedScreen`      |
| `CalendarExplain.dc.html`       | `/j/[code]/calendar`        | `CalendarExplainScreen`     |
| `CalendarPick.dc.html`          | `/j/[code]/calendar/pick`   | `CalendarPickScreen`        |
| `NoneWork.dc.html`              | `/j/[code]/none`            | `NoneWorkScreen`            |
| `Sent.dc.html`                  | `/j/[code]/sent`            | `SentScreen`                |

**Real since S1-25:** `/j/[code]` and `/j/[code]/none` render
`AvailabilityFlow`, which reads the plan and the member's own answer, keeps a
draft on the device (`data/availability/drafts.ts`) and sends through
`submit-availability`. `AvailabilityScreen` and `NoneWorkScreen` are now
presentational and take worked-out strings rather than a fixture; with no
backend the flow renders Sunday Crew's plan from `data/fixtures` (`answerable`).
`/p/[code]` shows the editor to a member who has not answered a plan that is
still asking (`PlanLinkFlow`), and the member candidates screen otherwise.
`Offline.dc.html` is a state of `/j/[code]` (`OfflineScreen`, offline and
error); `/offline` renders it for the gallery.

**Redesigned in S1-25b (ADR 0024):** days first, then a time once. The
screen is `AvailabilityScreen` composing `DayPicker` (the day grid and the time
panel) and `AnswerList` (the answer in words, a line opening to the day's
half-hour `Track`). Everything it shows is worked out in `view.ts` from the
reducer in `editor.ts`; the blocks are the domain's shortcuts (`blocks.ts`).
Which days are ticked and which is open are view state and never stored.
`AvailabilityPicking` and `AvailabilityAdjusting` are states of the same
route, not routes of their own.

**Real since S1-30:** `/j/[code]/sent` (`SentFlow`), `/j/[code]/check-email`
(`CheckEmailFlow`) and `/j/[code]/save-access` (`SaveAccessFlow`, which uses
`EnterCodeScreen` for the code). The two emailed pages are `/v` and `/e`, with
their token in the fragment (`/v#<token>`, ADR 0023), as is re-entry at `/a`:
the entry point takes the token out of the address bar before the router loads
(`data/links/tokens.ts`). `EmailVerifyFlow` and `EmailPrefsFlow` need no session.

### circles

| Artboard                      | Route                           | Component                   |
| ----------------------------- | ------------------------------- | --------------------------- |
| `CircleHome.dc.html`          | `/circles/[id]`                 | `CircleHomeScreen`          |
| `CircleHomeConfirmed.dc.html` | `/circles/[id]?state=confirmed` | `CircleHomeConfirmedScreen` |
| `CircleHomeDue.dc.html`       | `/circles/[id]?state=due`       | `CircleHomeDueScreen`       |
| `CircleHomeJoining.dc.html`   | `/circles/[id]?state=joining`   | `CircleHomeJoiningScreen`   |
| `CirclesList.dc.html`         | `/circles`                      | `CirclesListScreen`         |
| `CreateCircle.dc.html`        | `/circles/create`               | `CreateCircleScreen`        |
| `EmptyCircle.dc.html`         | `/circles/[id]?state=empty`     | `EmptyCircleScreen`         |
| `EmptyCirclesList.dc.html`    | `/circles/empty`                | `EmptyCirclesListScreen`    |
| `FirstCircle.dc.html`         | `/circles/new`                  | `FirstCircleScreen`         |
| `InviteCircle.dc.html`        | `/circles/[id]/invite`          | `InviteCircleScreen`        |
| `Settings.dc.html`            | `/circles/[id]/settings`        | `SettingsScreen`            |

**Real since S1-22:** `/circles/new` (`FirstCircleFlow`, through `create-circle`),
`/circles/[id]/invite` (`InviteCircleFlow`) and `/circles/[id]` (`CircleHomeFlow`).
**Since S1-22b (ADR 0026)** the first run goes `/circles/new` →
`/circles/[id]/plan/new` → the plan's share screen → the availability editor:
the invite screen and the filling-up home are reached from circle home, from
settings and from "Just invite people for now", and are no longer steps.
The invite secret comes back from `create-circle` once and is held in memory
(`data/circles/invite.ts`) for the invite screen; after a reload that screen
says the link is shown only when it is made (reset is S1-23's). The circle home
is live in two states — filling up (`CircleHomeJoiningScreen`, polled every
15 s) and finding a time (`CircleHomeScreen`); a circle in any other state shows
the filling-up home until the confirmed and due states are built. `?state=`
still picks a fixture state when there is no backend. Sharing goes through
`platform/share.ts`: the system sheet where there is one, a copy where there is
not.

**Real since S1-23:** `/circles` (`CirclesListFlow`: the first-run
`EmptyCirclesListScreen` when there are none, otherwise a row per circle with
its line from `lines.ts`), `/circles/create` (`CreateCircleFlow`, name, colour,
cadence and area through `create-circle`) and `/circles/[id]/settings`
(`SettingsFlow`: the link through `get-invite-link` / `rotate-invite`,
cadence and nudge pickers, colour, the reader's quiet-asks switch, members
with Remove through `remove-member`, Archive). Circle home picks its state with
the domain's `circleHomeState` (`HomeInState`): finding a time
(`CircleHomeScreen`), locked in (`CircleHomeConfirmedScreen`, "Details" to
`/circles/[id]/plan/[planId]/confirmed`), just you (`EmptyCircleScreen`), about
time and between catch-ups (`CircleHomeDueScreen`, `due` or not), and never
met (`CircleHomeJoiningScreen`). The invite link is the owner's: members are
not offered it. The reads are `data/circles` (`useCircles`, `useCircle`), all
through RLS; the secret is held in memory only (ADR 0028). A circle's colour is
a `circleColor` token from `@circles/tokens` (`CircleBadge`, `Swatches`).

### communication

| Artboard                       | Route                     | Component                    |
| ------------------------------ | ------------------------- | ---------------------------- |
| `CheckEmail.dc.html`           | `/j/[code]/check-email`   | `CheckEmailScreen`           |
| `EmailPrefs.dc.html`           | `/e` (`#token`)           | `EmailPrefsScreen`           |
| `EmailVerified.dc.html`        | `/v` (`#token`)           | `EmailVerifiedScreen`        |
| `NotificationSettings.dc.html` | `/settings/notifications` | `NotificationSettingsScreen` |
| `PushAsk.dc.html`              | `/settings/push`          | `PushAskScreen`              |

**Real since S1-23:** `/settings/notifications` (`NotificationSettingsFlow`):
per circle, `muted_all`, `muted_quiet_asks` and `muted_nudges` on the reader's
own membership; quiet hours are fixed at 9 pm–8 am and "Change" says so. The
organiser-email switch is SUS-83's.

### confirmation

| Artboard                 | Route                                   | Component              |
| ------------------------ | --------------------------------------- | ---------------------- |
| `AddToCalendar.dc.html`  | `/p/[code]/calendar`                    | `AddToCalendarSheet`   |
| `ConfirmedGuest.dc.html` | `/p/[code]/confirmed`                   | `ConfirmedGuestScreen` |
| `ConfirmedOrg.dc.html`   | `/circles/[id]/plan/[planId]/confirmed` | `ConfirmedOrgScreen`   |
| `ConfirmReview.dc.html`  | `/circles/[id]/plan/[planId]/review`    | `ConfirmReviewScreen`  |
| `Outcome.dc.html`        | `/circles/[id]/plan/[planId]/outcome`   | `OutcomeScreen`        |
| `WasThere.dc.html`       | `/p/[code]/attendance`                  | `WasThereScreen`       |

**Real since S1-28:** `/circles/[id]/plan/[planId]/review?candidate=<ISO start>`
renders `ReviewFlow`, and both `/circles/[id]/plan/[planId]/confirmed` and
`/p/[code]/confirmed` render `ConfirmedFlow` — **who you are picks the screen,
not the door**: the organiser gets `ConfirmedOrgScreen` wherever they arrive,
everybody else `ConfirmedGuestScreen`, so circle home's `locked_in` state links
to the first for everybody. `/p/[code]/calendar` is the same flow with the
add-to-calendar sheet open; the sheet (`AddToCalendarSheet`) opens over either
screen, and its Google Calendar row is held to Slice 3. The review reads
`data/scheduling` like the options do and locks in through `confirm-meetup`
with the set id it showed, read again at the tap (`useLockIn`); a set that
moves underneath is said on screen, never swapped in silently. The confirmed
read is `data/confirmation` (`meetup_confirmations` + `attendance` under RLS),
the paste-ready message is built on the client with the domain's
`lockedInMessage`, attendance is a direct write to the member's own row, and the
`.ics` is fetched from `generate-ics` when the sheet opens and handed over with
`<a download>` (`platform/download.ts`). "Open in Maps" is
`platform/maps.ts`. The organiser corrects their own answer on their screen
too. Once the meetup is over the confirmed door says so and counts nobody,
because "I was there" is readable by its subject alone. "Change the time ·
Cancel this plan" lead to S1-26's screens in `planning`. `Outcome` and
`WasThere` are still fixtures.

### growth

| Artboard                      | Route                  | Component                   |
| ----------------------------- | ---------------------- | --------------------------- |
| `AfterAttendance.dc.html`     | `/p/[code]/after`      | `AfterAttendanceScreen`     |
| `AppLanding.dc.html`          | `/get-the-app/welcome` | `AppLandingScreen`          |
| `AppSheet.dc.html`            | `/get-the-app`         | `AppSheetScreen`            |
| `ConfirmedGuestNudge.dc.html` | `/p/[code]/nudge`      | `ConfirmedGuestNudgeScreen` |
| `InitiateGate.dc.html`        | `/circles/gate`        | `InitiateGateScreen`        |
| `ReattachedNudge.dc.html`     | `/join/rejoined`       | `ReattachedNudgeScreen`     |
| `SecondSent.dc.html`          | `/j/[code]/sent-again` | `SecondSentScreen`          |

### identity

| Artboard              | Route                   | Component           |
| --------------------- | ----------------------- | ------------------- |
| `Account.dc.html`     | `/settings/account`     | `AccountScreen`     |
| `ContinueAs.dc.html`  | `/join/continue`        | `ContinueAsScreen`  |
| `Diagnostics.dc.html` | `/settings/diagnostics` | `DiagnosticsScreen` |
| `EnterCode.dc.html`   | `/sign-in` (code step)  | `EnterCodeScreen`   |
| `LinkInvalid.dc.html` | `/join/invalid`         | `LinkInvalidScreen` |
| `Main.dc.html`        | `/join`                 | `MainScreen`        |
| `Name.dc.html`        | `/join/name`            | `NameScreen`        |
| `Privacy.dc.html`     | `/settings/privacy`     | `PrivacyScreen`     |
| `SaveAccess.dc.html`  | `/j/[code]/save-access` | `SaveAccessScreen`  |
| `SignIn.dc.html`      | `/sign-in`              | `SignInScreen`      |
| `Welcome.dc.html`     | `/`                     | `WelcomeScreen`     |
| `YourName.dc.html`    | `/name`                 | `YourNameScreen`    |

**Real since S1-22:** `/` (`WelcomeFlow`), `/sign-in` (`SignInFlow`, which
drives `SignInScreen` and `EnterCodeScreen` on one route so the address never
travels in a URL) and `/name` (`YourNameFlow`, with `TimeZoneScreen` for the
zone). `/sign-in?next=/j/<code>` is where "I have an account" on a plan link
leads (ADR 0022); only a plan link survives as `next` (`data/auth/returnPath.ts`).
`/(auth)/code` redirects to `/sign-in` when there is a backend. `/terms` and
`/privacy` are static (`LegalScreen`) and have no artboard.

**Real since S1-23:** `/settings/account` (`AccountFlow`: name and time zone
through `saveProfile`, the session's own address shown, Privacy and
Notifications, Sign out). "Delete my account and data" is on the artboard and
is not drawn until S4-05 builds `delete-account`. `/settings/privacy` is the
artboard's static copy.

### planning

| Artboard                    | Route                                     | Component                 |
| --------------------------- | ----------------------------------------- | ------------------------- |
| `CancelledGuest.dc.html`    | `/p/[code]/cancelled`                     | `CancelledGuestScreen`    |
| `CancelledOrg.dc.html`      | `/circles/[id]/plan/[planId]/cancelled`   | `CancelledOrgScreen`      |
| `CancelPlan.dc.html`        | `/circles/[id]/plan/[planId]/cancel`      | `CancelPlanScreen`        |
| `ChangeTime.dc.html`        | `/circles/[id]/plan/[planId]/change-time` | `ChangeTimeScreen`        |
| `ChooseMode.dc.html`        | `/circles/[id]/plan/mode`                 | `ChooseModeScreen`        |
| `CustomWindow.dc.html`      | `/circles/[id]/plan/window`               | `CustomWindowScreen`      |
| `EditPlan.dc.html`          | `/circles/[id]/plan/[planId]/edit`        | `EditPlanScreen`          |
| `FirstPlan.dc.html`         | `/circles/[id]/plan/new`                  | `FirstPlanScreen`         |
| `InterestPrompt.dc.html`    | `/circles/[id]/quiet/interest`            | `InterestPromptScreen`    |
| `PlanAnother.dc.html`       | `/circles/[id]/plan/another`              | `PlanAnotherScreen`       |
| `PlanSetup.dc.html`         | `/circles/[id]/plan/setup`                | `PlanSetupScreen`         |
| `PlanShared.dc.html`        | `/circles/[id]/plan/[planId]/shared`      | `PlanSharedScreen`        |
| `RescheduledGuest.dc.html`  | `/p/[code]/rescheduled`                   | `RescheduledGuestScreen`  |
| `SparkExpired.dc.html`      | `/circles/[id]/quiet/expired`             | `SparkExpiredScreen`      |
| `SparkOpenedMember.dc.html` | `/circles/[id]/quiet/opened`              | `SparkOpenedMemberScreen` |
| `SparkSetup.dc.html`        | `/circles/[id]/quiet/new`                 | `SparkSetupScreen`        |
| `SparkWaiting.dc.html`      | `/circles/[id]/quiet/waiting`             | `SparkWaitingScreen`      |
| `ThresholdRole.dc.html`     | `/circles/[id]/quiet/threshold`           | `ThresholdRoleScreen`     |
| `Volunteer.dc.html`         | `/circles/[id]/quiet/volunteer`           | `VolunteerScreen`         |

**Real since S1-22:** `/circles/[id]/plan/new` (`FirstPlanFlow`, through
`create-plan` with the `next_14_days` preset and nothing else, so the server
resolves the quorum when the plan is made) and
`/circles/[id]/plan/[planId]/shared` (`PlanSharedFlow`, `newPlanMessage` with
the plan's short link). "Change" and "See if people are keen instead" still lead
to the setup (S1-26) and the fixture quiet-ask screens (S2-02).

**Real since S1-26:** the rest of the plan's life, all through `data/planning`
(`planDetails` under RLS; `createPlan`, `previewRevision` / `saveRevision`
and `cancelPlan` through the Edge Functions).

- `/circles/[id]/plan/setup` (`PlanSetupFlow`) — every control on one form
  (`usePlanForm`, `PlanControls`): intent, the five presets (tonight hidden when
  the meetup no longer fits), times of day (`BandPicker`: evenings, daytime, or
  any half-hour band), duration, the quorum stepper, who has to be there, and
  when replies close (`DeadlineSheet`, anything up to the last possible start).
  What the card says is `resolveDraft` — the domain's `resolvePreset` and
  `defaultDeadline` — and **only what was changed is sent**, so an untouched
  quorum stays defaulted and follows the plan's audience (ADR 0026).
  `/circles/[id]/plan/window` is the same flow opened on its calendar
  (`CustomWindowScreen`, a `DayGrid` month, at most 14 days).
- `/circles/[id]/plan/mode` (`ChooseModeFlow`) — Plan openly; the quiet card is
  behind `flags.quietAsk` (`@circles/config`) until S2-03.
- `/circles/[id]/plan/[planId]/edit` (`EditPlanFlow`) — the setup's controls,
  prefilled, the request being **the difference** (`resolveEdit`). A preview
  runs once the form is still (`useRevision`), so the re-ask warning — the
  preview's own `asked_again` and `fresh_ask`, "you" first, names then a count —
  is on screen before Save, and Save carries the preview's `expected_version`;
  `preview_is_stale` asks the preview again. New dates move the deadline to the
  preset's default ("moved to match the new dates"). After a change that asks
  again, `shared?again=1` hands over the message to paste.
- `/circles/[id]/plan/[planId]/change-time` (`ChangeTimeFlow`) — a reopen
  (`revise-plan` with `reopen: true`) with a new window and a deadline still
  ahead, previewed the same way; then `shared?again=1` with "Change of plan:
  Thursday is off". The new window starts the day after the time it takes off
  the table ("14 days from Fri 18 Sep"; the calendar holds those days back), so
  what members are told stays true of every time they can be offered.
- Cancelling is reachable wherever the plan is: the confirmed screen, EditPlan
  while it is asking, and — for the circle's owner, who may cancel somebody
  else's plan (§4.5) — the member's plan page (`MemberView`). The options
  screen in `ready` now has "Edit the plan" too.
- `/circles/[id]/plan/[planId]/cancel` and `…/cancelled` (`CancelPlanFlow`,
  `CancelledFlow`) — the organiser's or the owner's; an optional note that goes
  to `cancel-plan` and nowhere else, then the paste-ready update
  (`EN_SHARE_TEMPLATES.cancelled`).
- `/p/[code]` goes through `PlanChangeGate` first: a cancelled plan sends a
  member to `/p/[code]/cancelled` (`MemberCancelledFlow`, with the organiser's
  note), and a reopened one sends somebody who has not answered the new
  question to `/p/[code]/rescheduled` (`RescheduledFlow`, the old time struck
  through) before the editor.

### scheduling

| Artboard                   | Route                                    | Component                |
| -------------------------- | ---------------------------------------- | ------------------------ |
| `Candidates.dc.html`       | `/circles/[id]/plan/[planId]/candidates` | `CandidatesScreen`       |
| `CandidatesMember.dc.html` | `/p/[code]`                              | `CandidatesMemberScreen` |
| `DeadlinePassed.dc.html`   | `/circles/[id]/plan/[planId]/deadline`   | `DeadlinePassedScreen`   |
| `NoQuorum.dc.html`         | `/circles/[id]/plan/[planId]/no-quorum`  | `NoQuorumScreen`         |
| `Waiting.dc.html`          | `/circles/[id]/plan/[planId]/waiting`    | `WaitingScreen`          |

**Real since S1-27:** `/circles/[id]/plan/[planId]/{candidates,waiting,no-quorum}`
all render `CandidatesFlow`, and `/p/[code]` renders `MemberCandidatesFlow`
behind `PlanLinkFlow`. One flow behind three organiser routes, because which of
them is true is a fact about the data and changes while the screen is open: the
route only picks which fixture to show with no backend. The read is
`data/scheduling` (`candidate_sets` + `candidates` + `plan_participants` +
`response_summaries`, all under RLS, no function), refetched on focus and every
twenty seconds — three while a recalculation is known to be in flight. The four
screens are presentational and take worked-out strings: `cards.ts` for an
option, `view.ts` for the header and the lines around it, `lines.ts` for the
ones a flow assembles, and `sentences.ts` for the one rule all of them use to
name people (`names.ts`: up to three, then a count — ADR 0012). The no-quorum
actions are `unlock.ts`, which never offers a quorum below two and never a
wider window a re-ask could not be answered in.
A member at `/p/[code]` sees the options and "Change my times"; the organiser is
sent to their own route. `DeadlinePassed` is still a fixture (Slice 2), and
"Review <weekday>" leads to `ConfirmReview` with the chosen candidate's start
instant as `candidate` (S1-28). A plan that is locked in sends both doors to
its confirmed screen rather than saying "This plan is decided".

### system

| Artboard          | Route      | Component       |
| ----------------- | ---------- | --------------- |
| `Offline.dc.html` | `/offline` | `OfflineScreen` |

## Not screens

Five artboards are reference sheets rather than screens, and have no route:
`Components`, `ConversionMap`, `Emails`, `Pushes`, `ShareMessages`.

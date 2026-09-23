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

| Artboard                   | Route                                     | Component                |
| -------------------------- | ----------------------------------------- | ------------------------ |
| `AddToCalendar.dc.html`    | `/p/[code]/calendar`                      | `AddToCalendarScreen`    |
| `CancelledGuest.dc.html`   | `/p/[code]/cancelled`                     | `CancelledGuestScreen`   |
| `ChangeTime.dc.html`       | `/circles/[id]/plan/[planId]/change-time` | `ChangeTimeScreen`       |
| `ConfirmedGuest.dc.html`   | `/p/[code]/confirmed`                     | `ConfirmedGuestScreen`   |
| `ConfirmedOrg.dc.html`     | `/circles/[id]/plan/[planId]/confirmed`   | `ConfirmedOrgScreen`     |
| `ConfirmReview.dc.html`    | `/circles/[id]/plan/[planId]/review`      | `ConfirmReviewScreen`    |
| `Outcome.dc.html`          | `/circles/[id]/plan/[planId]/outcome`     | `OutcomeScreen`          |
| `RescheduledGuest.dc.html` | `/p/[code]/rescheduled`                   | `RescheduledGuestScreen` |
| `WasThere.dc.html`         | `/p/[code]/attendance`                    | `WasThereScreen`         |

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

| Artboard                    | Route                                   | Component                 |
| --------------------------- | --------------------------------------- | ------------------------- |
| `CancelledOrg.dc.html`      | `/circles/[id]/plan/[planId]/cancelled` | `CancelledOrgScreen`      |
| `CancelPlan.dc.html`        | `/circles/[id]/plan/[planId]/cancel`    | `CancelPlanScreen`        |
| `ChooseMode.dc.html`        | `/circles/[id]/plan/mode`               | `ChooseModeScreen`        |
| `CustomWindow.dc.html`      | `/circles/[id]/plan/window`             | `CustomWindowScreen`      |
| `EditPlan.dc.html`          | `/circles/[id]/plan/[planId]/edit`      | `EditPlanScreen`          |
| `FirstPlan.dc.html`         | `/circles/[id]/plan/new`                | `FirstPlanScreen`         |
| `InterestPrompt.dc.html`    | `/circles/[id]/quiet/interest`          | `InterestPromptScreen`    |
| `PlanAnother.dc.html`       | `/circles/[id]/plan/another`            | `PlanAnotherScreen`       |
| `PlanSetup.dc.html`         | `/circles/[id]/plan/setup`              | `PlanSetupScreen`         |
| `PlanShared.dc.html`        | `/circles/[id]/plan/[planId]/shared`    | `PlanSharedScreen`        |
| `SparkExpired.dc.html`      | `/circles/[id]/quiet/expired`           | `SparkExpiredScreen`      |
| `SparkOpenedMember.dc.html` | `/circles/[id]/quiet/opened`            | `SparkOpenedMemberScreen` |
| `SparkSetup.dc.html`        | `/circles/[id]/quiet/new`               | `SparkSetupScreen`        |
| `SparkWaiting.dc.html`      | `/circles/[id]/quiet/waiting`           | `SparkWaitingScreen`      |
| `ThresholdRole.dc.html`     | `/circles/[id]/quiet/threshold`         | `ThresholdRoleScreen`     |
| `Volunteer.dc.html`         | `/circles/[id]/quiet/volunteer`         | `VolunteerScreen`         |

**Real since S1-22:** `/circles/[id]/plan/new` (`FirstPlanFlow`, through
`create-plan` with the `next_14_days` preset and nothing else, so the server
resolves the quorum when the plan is made) and
`/circles/[id]/plan/[planId]/shared` (`PlanSharedFlow`, `newPlanMessage` with
the plan's short link). "Change" and "See if people are keen instead" still lead
to the fixture setup and quiet-ask screens (S1-26, S2-02).

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
"Review <weekday>" leads to the fixture `ConfirmReview` with the chosen
candidate's start instant as `candidate` (S1-28).

### system

| Artboard          | Route      | Component       |
| ----------------- | ---------- | --------------- |
| `Offline.dc.html` | `/offline` | `OfflineScreen` |

## Not screens

Five artboards are reference sheets rather than screens, and have no route:
`Components`, `ConversionMap`, `Emails`, `Pushes`, `ShareMessages`.

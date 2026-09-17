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

| Artboard                      | Route                       | Component                   |
| ----------------------------- | --------------------------- | --------------------------- |
| `Availability.dc.html`        | `/j/[code]`                 | `AvailabilityScreen`        |
| `AvailabilityOverlay.dc.html` | `/j/[code]/overlay`         | `AvailabilityOverlayScreen` |
| `CalendarDenied.dc.html`      | `/j/[code]/calendar/denied` | `CalendarDeniedScreen`      |
| `CalendarExplain.dc.html`     | `/j/[code]/calendar`        | `CalendarExplainScreen`     |
| `CalendarPick.dc.html`        | `/j/[code]/calendar/pick`   | `CalendarPickScreen`        |
| `NoneWork.dc.html`            | `/j/[code]/none`            | `NoneWorkScreen`            |
| `Sent.dc.html`                | `/j/[code]/sent`            | `SentScreen`                |

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

### communication

| Artboard                       | Route                     | Component                    |
| ------------------------------ | ------------------------- | ---------------------------- |
| `CheckEmail.dc.html`           | `/j/[code]/check-email`   | `CheckEmailScreen`           |
| `EmailPrefs.dc.html`           | `/e/[token]`              | `EmailPrefsScreen`           |
| `EmailVerified.dc.html`        | `/v/[token]`              | `EmailVerifiedScreen`        |
| `NotificationSettings.dc.html` | `/settings/notifications` | `NotificationSettingsScreen` |
| `PushAsk.dc.html`              | `/settings/push`          | `PushAskScreen`              |

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
| `EnterCode.dc.html`   | `/(auth)/code`          | `EnterCodeScreen`   |
| `LinkInvalid.dc.html` | `/join/invalid`         | `LinkInvalidScreen` |
| `Main.dc.html`        | `/join`                 | `MainScreen`        |
| `Name.dc.html`        | `/join/name`            | `NameScreen`        |
| `Privacy.dc.html`     | `/settings/privacy`     | `PrivacyScreen`     |
| `SaveAccess.dc.html`  | `/j/[code]/save-access` | `SaveAccessScreen`  |
| `SignIn.dc.html`      | `/(auth)/sign-in`       | `SignInScreen`      |
| `Welcome.dc.html`     | `/`                     | `WelcomeScreen`     |
| `YourName.dc.html`    | `/(auth)/name`          | `YourNameScreen`    |

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

### scheduling

| Artboard                   | Route                                    | Component                |
| -------------------------- | ---------------------------------------- | ------------------------ |
| `Candidates.dc.html`       | `/circles/[id]/plan/[planId]/candidates` | `CandidatesScreen`       |
| `CandidatesMember.dc.html` | `/p/[code]`                              | `CandidatesMemberScreen` |
| `DeadlinePassed.dc.html`   | `/circles/[id]/plan/[planId]/deadline`   | `DeadlinePassedScreen`   |
| `NoQuorum.dc.html`         | `/circles/[id]/plan/[planId]/no-quorum`  | `NoQuorumScreen`         |
| `Waiting.dc.html`          | `/circles/[id]/plan/[planId]/waiting`    | `WaitingScreen`          |

### system

| Artboard          | Route      | Component       |
| ----------------- | ---------- | --------------- |
| `Offline.dc.html` | `/offline` | `OfflineScreen` |

## Not screens

Five artboards are reference sheets rather than screens, and have no route:
`Components`, `ConversionMap`, `Emails`, `Pushes`, `ShareMessages`.

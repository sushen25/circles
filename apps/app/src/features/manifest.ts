/**
 * Every screen, its context and where it lives. Generated alongside the
 * screens by `scripts/scaffold-screens.mjs`; the gallery reads it so a new
 * screen appears there without anyone remembering to add it.
 *
 * A screen that is a *state* of another (manifesto §7) shares its route and is
 * reached with `?state=` rather than a URL of its own.
 */
export type ScreenEntry = {
  screen: string;
  feature: string;
  href: string;
};

const SCREENS: ScreenEntry[] = [
  {
    screen: 'Main',
    feature: 'identity',
    href: '/join',
  },
  {
    screen: 'ContinueAs',
    feature: 'identity',
    href: '/join/continue',
  },
  {
    screen: 'Name',
    feature: 'identity',
    href: '/join/name',
  },
  {
    screen: 'Availability',
    feature: 'availability',
    href: '/j/[code]',
  },
  {
    screen: 'NoneWork',
    feature: 'availability',
    href: '/j/[code]/none',
  },
  {
    screen: 'Sent',
    feature: 'availability',
    href: '/j/[code]/sent',
  },
  {
    screen: 'CheckEmail',
    feature: 'communication',
    href: '/j/[code]/check-email',
  },
  {
    screen: 'EmailVerified',
    feature: 'communication',
    href: '/v',
  },
  {
    screen: 'EmailPrefs',
    feature: 'communication',
    href: '/e',
  },
  {
    screen: 'SaveAccess',
    feature: 'identity',
    href: '/j/[code]/save-access',
  },
  {
    screen: 'CandidatesMember',
    feature: 'scheduling',
    href: '/p/[code]',
  },
  {
    screen: 'ConfirmedGuest',
    feature: 'confirmation',
    href: '/p/[code]/confirmed',
  },
  {
    screen: 'AddToCalendar',
    feature: 'confirmation',
    href: '/p/[code]/calendar',
  },
  {
    screen: 'RescheduledGuest',
    feature: 'confirmation',
    href: '/p/[code]/rescheduled',
  },
  {
    screen: 'CancelledGuest',
    feature: 'confirmation',
    href: '/p/[code]/cancelled',
  },
  {
    screen: 'WasThere',
    feature: 'confirmation',
    href: '/p/[code]/attendance',
  },
  {
    screen: 'LinkInvalid',
    feature: 'identity',
    href: '/join/invalid',
  },
  {
    screen: 'Welcome',
    feature: 'identity',
    href: '/',
  },
  {
    screen: 'SignIn',
    feature: 'identity',
    href: '/(auth)/sign-in',
  },
  {
    screen: 'EnterCode',
    feature: 'identity',
    href: '/(auth)/code',
  },
  {
    screen: 'YourName',
    feature: 'identity',
    href: '/(auth)/name',
  },
  {
    screen: 'FirstCircle',
    feature: 'circles',
    href: '/circles/new',
  },
  {
    screen: 'InviteCircle',
    feature: 'circles',
    href: '/circles/sunday-crew/invite',
  },
  {
    screen: 'CircleHomeJoining',
    feature: 'circles',
    href: '/circles/sunday-crew?state=joining',
  },
  {
    screen: 'FirstPlan',
    feature: 'planning',
    href: '/circles/sunday-crew/plan/new',
  },
  {
    screen: 'PlanShared',
    feature: 'planning',
    href: '/circles/sunday-crew/plan/thu-17/shared',
  },
  {
    screen: 'CircleHome',
    feature: 'circles',
    href: '/circles/sunday-crew',
  },
  {
    screen: 'EmptyCirclesList',
    feature: 'circles',
    href: '/circles/empty',
  },
  {
    screen: 'CirclesList',
    feature: 'circles',
    href: '/circles',
  },
  {
    screen: 'CreateCircle',
    feature: 'circles',
    href: '/circles/create',
  },
  {
    screen: 'ChooseMode',
    feature: 'planning',
    href: '/circles/sunday-crew/plan/mode',
  },
  {
    screen: 'PlanSetup',
    feature: 'planning',
    href: '/circles/sunday-crew/plan/setup',
  },
  {
    screen: 'CustomWindow',
    feature: 'planning',
    href: '/circles/sunday-crew/plan/window',
  },
  {
    screen: 'Waiting',
    feature: 'scheduling',
    href: '/circles/sunday-crew/plan/thu-17/waiting',
  },
  {
    screen: 'Candidates',
    feature: 'scheduling',
    href: '/circles/sunday-crew/plan/thu-17/candidates',
  },
  {
    screen: 'DeadlinePassed',
    feature: 'scheduling',
    href: '/circles/sunday-crew/plan/thu-17/deadline',
  },
  {
    screen: 'EditPlan',
    feature: 'planning',
    href: '/circles/sunday-crew/plan/thu-17/edit',
  },
  {
    screen: 'ConfirmReview',
    feature: 'confirmation',
    href: '/circles/sunday-crew/plan/thu-17/review',
  },
  {
    screen: 'ConfirmedOrg',
    feature: 'confirmation',
    href: '/circles/sunday-crew/plan/thu-17/confirmed',
  },
  {
    screen: 'CircleHomeConfirmed',
    feature: 'circles',
    href: '/circles/sunday-crew?state=confirmed',
  },
  {
    screen: 'ChangeTime',
    feature: 'confirmation',
    href: '/circles/sunday-crew/plan/thu-17/change-time',
  },
  {
    screen: 'CancelPlan',
    feature: 'planning',
    href: '/circles/sunday-crew/plan/thu-17/cancel',
  },
  {
    screen: 'CancelledOrg',
    feature: 'planning',
    href: '/circles/sunday-crew/plan/thu-17/cancelled',
  },
  {
    screen: 'NoQuorum',
    feature: 'scheduling',
    href: '/circles/sunday-crew/plan/thu-17/no-quorum',
  },
  {
    screen: 'Outcome',
    feature: 'confirmation',
    href: '/circles/sunday-crew/plan/thu-17/outcome',
  },
  {
    screen: 'CircleHomeDue',
    feature: 'circles',
    href: '/circles/sunday-crew?state=due',
  },
  {
    screen: 'PlanAnother',
    feature: 'planning',
    href: '/circles/sunday-crew/plan/another',
  },
  {
    screen: 'Settings',
    feature: 'circles',
    href: '/circles/sunday-crew/settings',
  },
  {
    screen: 'NotificationSettings',
    feature: 'communication',
    href: '/settings/notifications',
  },
  {
    screen: 'Account',
    feature: 'identity',
    href: '/settings/account',
  },
  {
    screen: 'Privacy',
    feature: 'identity',
    href: '/settings/privacy',
  },
  {
    screen: 'Diagnostics',
    feature: 'identity',
    href: '/settings/diagnostics',
  },
  {
    screen: 'SparkSetup',
    feature: 'planning',
    href: '/circles/sunday-crew/quiet/new',
  },
  {
    screen: 'SparkWaiting',
    feature: 'planning',
    href: '/circles/sunday-crew/quiet/waiting',
  },
  {
    screen: 'InterestPrompt',
    feature: 'planning',
    href: '/circles/sunday-crew/quiet/interest',
  },
  {
    screen: 'ThresholdRole',
    feature: 'planning',
    href: '/circles/sunday-crew/quiet/threshold',
  },
  {
    screen: 'Volunteer',
    feature: 'planning',
    href: '/circles/sunday-crew/quiet/volunteer',
  },
  {
    screen: 'SparkOpenedMember',
    feature: 'planning',
    href: '/circles/sunday-crew/quiet/opened',
  },
  {
    screen: 'SparkExpired',
    feature: 'planning',
    href: '/circles/sunday-crew/quiet/expired',
  },
  {
    screen: 'PushAsk',
    feature: 'communication',
    href: '/settings/push',
  },
  {
    screen: 'CalendarExplain',
    feature: 'availability',
    href: '/j/[code]/calendar',
  },
  {
    screen: 'CalendarPick',
    feature: 'availability',
    href: '/j/[code]/calendar/pick',
  },
  {
    screen: 'AvailabilityOverlay',
    feature: 'availability',
    href: '/j/[code]/overlay',
  },
  {
    screen: 'CalendarDenied',
    feature: 'availability',
    href: '/j/[code]/calendar/denied',
  },
  {
    screen: 'ConfirmedGuestNudge',
    feature: 'growth',
    href: '/p/[code]/nudge',
  },
  {
    screen: 'AppSheet',
    feature: 'growth',
    href: '/get-the-app',
  },
  {
    screen: 'ReattachedNudge',
    feature: 'growth',
    href: '/join/rejoined',
  },
  {
    screen: 'SecondSent',
    feature: 'growth',
    href: '/j/[code]/sent-again',
  },
  {
    screen: 'AfterAttendance',
    feature: 'growth',
    href: '/p/[code]/after',
  },
  {
    screen: 'InitiateGate',
    feature: 'growth',
    href: '/circles/gate',
  },
  {
    screen: 'AppLanding',
    feature: 'growth',
    href: '/get-the-app/welcome',
  },
  {
    screen: 'EmptyCircle',
    feature: 'circles',
    href: '/circles/sunday-crew?state=empty',
  },
  {
    screen: 'Offline',
    feature: 'system',
    href: '/offline',
  },
];

export default SCREENS;

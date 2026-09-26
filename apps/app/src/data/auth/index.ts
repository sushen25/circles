/**
 * The auth module (architecture §10, spec §5.1, ADR 0004).
 *
 * One client, one session, three identity tiers. What a screen should need from
 * here is `useSession` to know who is present, `guard` to know what to do about
 * it, and one of the actions below — never the Supabase client itself, which is
 * why it is not re-exported.
 *
 * Apple and Google are S1-14b (SUS-77). They arrive as two more files under
 * `providers/`, and everything else here is already provider-agnostic: `link.ts`
 * takes the sign-in as an argument, and `SignedIn` carries the name an SSO
 * provider can suggest and the email path cannot.
 */

export { PLATFORM_HEADER, platformName } from './client';
export { currentSession, ensureGuestSession, isAnonymous } from './guest';
export { guard } from './guards';
export type { GuardDecision, GuardInput, Membership, RouteKind } from './guards';
export { SavePlaceError, resumePendingClaim, savePlace } from './link';
export type { SaveMoment, SavePlaceOptions, SavedPlace } from './link';
export {
  ProfileNameError,
  bootstrapProfile,
  deviceTimeZone,
  ownDisplayName,
  ownEmailHint,
  ownProfile,
  saveProfile,
} from './profile';
export type { OwnProfile, ProfileBootstrap } from './profile';
export {
  requestLinkCode,
  requestSignInCode,
  submitLinkCode,
  submitSignInCode,
} from './providers/email';
export type { ProviderId, SignedIn } from './providers/types';
export { safeReturnPath } from './returnPath';
export { markAppInstalled } from './install';
export { appTierSettled, onAppFirstOpen } from './appTier';
export { sessionState, signOut, startSessionTracking, useSession } from './session';
export type { SessionState, SessionStatus } from './session';
export { getTurnstileToken } from './turnstile';

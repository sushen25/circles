/**
 * The circle context: the authorisation root and the unit of retention
 * (architecture §6.2). Every other context asks "is this person a member of
 * that circle?" before it does anything.
 *
 * Lower-cased on purpose. The context is named for the `Circle` aggregate, and
 * the capitalised plural is the product's display name, which `check:brand`
 * keeps to `brand.ts` because it may change (§5.4). The aggregate keeps its
 * name whatever the product ends up being called.
 *
 * Ids are plain branded strings here rather than imports from `@circles/contracts`:
 * the dependency rule points the other way, and `contracts` wraps these types
 * rather than the reverse (architecture §7.2).
 */

import type { Instant } from '../shared/instant.js';
import type { Zone } from '../shared/zone.js';

export type CircleId = string & { readonly __brand: 'CircleId' };
export type UserId = string & { readonly __brand: 'UserId' };

export function circleId(value: string): CircleId {
  if (value.length === 0) throw new RangeError('Empty circle id');
  return value as CircleId;
}

export function userId(value: string): UserId {
  if (value.length === 0) throw new RangeError('Empty user id');
  return value as UserId;
}

/**
 * The loose rhythm a circle aims for. `none` is a real choice, not an absence:
 * "No goal set" is a state the circle home renders, and it suppresses nudges
 * entirely (spec §5.9).
 */
export type Cadence = 'weekly' | 'fortnightly' | 'monthly' | 'two_monthly' | 'none';

/** Who gets nudged when a circle is due (spec §5.9). */
export type NudgePolicy = 'last_organiser' | 'take_turns' | 'owner';

export type MemberRole = 'owner' | 'member';

/** `removed` keeps the row: confirmed-meetup history survives (spec §5.2). */
export type MemberStatus = 'active' | 'removed';

export type CircleStatus = 'active' | 'archived';

export type Circle = {
  readonly id: CircleId;
  readonly ownerUserId: UserId;
  readonly name: string;
  /** Solid colour, no image (spec §5.2). A token name, not a hex value. */
  readonly color: string;
  /** Primary zone, defaulted from the creator's device. Cadence maths uses it. */
  readonly zone: Zone;
  readonly cadence: Cadence;
  /**
   * Absent until someone chooses. `nudgeRecipientFor` resolves the default
   * lazily — take turns for four or more, otherwise the owner (spec §5.2) —
   * so a circle that grows past three starts taking turns without a migration.
   */
  readonly nudgePolicy?: NudgePolicy;
  readonly defaultDurationMinutes: number;
  /** Absent means "compute it from the active member count" (`quorumDefault`). */
  readonly defaultQuorum?: number;
  readonly defaultArea?: string;
  readonly status: CircleStatus;
  /** Set by a reported-happened outcome. Absent means the circle has never met. */
  readonly lastMetAt?: Instant;
  /** While this is in the future, the circle is never `due_soon`. */
  readonly cadenceSnoozedUntil?: Instant;
};

export type Member = {
  readonly circleId: CircleId;
  readonly userId: UserId;
  /** A snapshot, not a join: a removed member's history keeps the name it had. */
  readonly displayName: string;
  readonly role: MemberRole;
  readonly status: MemberStatus;
  readonly joinedAt: Instant;
  readonly mutedQuietAsks: boolean;
  readonly mutedAll: boolean;
  /**
   * "Nudges to plan the next one" is off for this circle
   * (`circle_members.muted_nudges`). Only the cadence nudge reads it: someone
   * who does not want to be asked to organise still wants to know when a plan
   * is locked in.
   */
  readonly mutedNudges: boolean;
  /**
   * A permanent identity (email, Apple, Google) rather than an anonymous one.
   * Only permanent members can be nudged or hold the organiser role
   * (architecture §6.1) — an anonymous session has nowhere to receive a nudge.
   */
  readonly isPermanent: boolean;
};

/**
 * A rotatable capability link. The secret itself never lives here or in the
 * database — only its SHA-256 (architecture §14). Resetting means writing a new
 * hash, which invalidates the old link without disturbing existing members
 * (spec §5.2).
 */
export type Invite = {
  readonly circleId: CircleId;
  readonly secretHash: string;
  readonly revokedAt?: Instant;
};

export function isActive(member: Member): boolean {
  return member.status === 'active';
}

export function isInviteUsable(invite: Invite, now: Instant): boolean {
  return invite.revokedAt === undefined || invite.revokedAt > now;
}

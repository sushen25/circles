/**
 * The single place the product's display name, domain, sender and deep-link
 * scheme are written down (architecture §5.4).
 *
 * `circles` stays the package scope and the bundle-identifier prefix
 * (`app.circles.*`) whatever the product ends up being called; everything a
 * person can see or receive mail from is read from here. Renaming is then a
 * change to this file plus store submissions, not a refactor.
 *
 * `domain` is a **holding** domain on the founder's personal apex, chosen in
 * S0-11 so links could ship before the product has a name. It says what the
 * thing does rather than what it is called, so it stays true through the
 * rename. It will be replaced; nothing may assume it. Links are never shipped
 * on `*.expo.app` (architecture §5.2).
 *
 * `dev.sushensatturu.com` is the matching non-production host. It is not
 * written here because nothing user-visible ever points at it — it arrives
 * through `EXPO_PUBLIC_APP_ORIGIN`.
 */
export const brand = {
  /** Display name, used in UI, emails and store metadata. */
  name: 'Circles',
  /** Link and app host. Holding domain — see above. */
  domain: 'meet.sushensatturu.com',
  /** Transactional sender. Mail goes out on a separate authenticated subdomain. */
  sender: 'Circles <hello@mail.meet.sushensatturu.com>',
  /**
   * Replies land here. **Nothing receives mail at this address yet** — the
   * holding domain has no MX record. Set up forwarding before any email that
   * carries it is sent (S1-19), or a reply to a real person vanishes.
   */
  supportEmail: 'support@meet.sushensatturu.com',
  /** Deep-link scheme for native universal/app links. */
  scheme: 'circles',
} as const;

export type Brand = typeof brand;

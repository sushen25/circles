/**
 * The single place the product's display name, domain, sender and deep-link
 * scheme are written down (architecture §5.4).
 *
 * `circles` stays the package scope and the bundle-identifier prefix
 * (`app.circles.*`) whatever the product ends up being called; everything a
 * person can see or receive mail from is read from here. Renaming is then a
 * change to this file plus store submissions, not a refactor.
 *
 * `domain` is a placeholder. The real domain is chosen with the name; until
 * then S0-11 points these at a neutral holding domain the founder owns. Links
 * are never shipped on `*.expo.app` (architecture §5.2).
 */
export const brand = {
  /** Display name, used in UI, emails and store metadata. */
  name: 'Circles',
  /** Link and app host. Placeholder until S0-11. */
  domain: 'circles.app',
  /** Transactional sender. Mail goes out on a separate authenticated subdomain. */
  sender: 'Circles <hello@mail.circles.app>',
  supportEmail: 'support@circles.app',
  /** Deep-link scheme for native universal/app links. */
  scheme: 'circles',
} as const;

export type Brand = typeof brand;

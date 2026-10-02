/**
 * The single place the product's display name, domain, sender and deep-link
 * scheme are written down (architecture §5.4).
 *
 * The product is called Wenna (SUS-98); Circles is its codename. `circles`
 * stays the package scope, the bundle-identifier prefix (`app.circles.*`), the
 * EAS slug and the deep-link `scheme` below: installed builds and the links
 * they claim depend on those, so changing any of them is a deliberate decision
 * with its own migration, never a side effect of the rename. Everything a
 * person can see or receive mail from is read from here. Renaming is then a
 * change to this file plus store submissions, not a refactor.
 *
 * `domain` is the production host, `wenna.app` since SUS-99. Links are
 * never shipped on `*.expo.app` (architecture §5.2).
 *
 * There is no matching non-production host. EAS Hosting allows one custom
 * domain per project and production takes it, so `dev` stays on the
 * `expo.app` URL — which is fine, because nothing user-visible ever points at
 * `dev`: it arrives through `EXPO_PUBLIC_APP_ORIGIN`.
 *
 * **Once the first invite link reaches somebody who is not the founder, this
 * domain is permanent.** Links already sitting in group chats cannot be
 * recalled, so any later change of host needs the old one kept answering with
 * a redirect for as long as those links matter — indefinitely, in practice.
 * EAS serves one custom domain per project, so that redirect has to live
 * somewhere other than EAS.
 */
export const brand = {
  /** Display name, used in UI, emails and store metadata. */
  name: 'Wenna',
  /**
   * The line that sits beside the name: under the wordmark on the landing and
   * sign-in screens, the store subtitle, the link-preview image.
   */
  descriptor: 'Plans with friends',
  /**
   * Who the product is operated by, as every email footer names it (SUS-111):
   * "Sent by Wenna, operated by <operator>". For now the business is not
   * registered, so this is the brand name and the footer says only "Sent by
   * Wenna". When there is a legal name and an ABN, this one line becomes
   * e.g. `'Example Pty Ltd (ABN 12 345 678 901)'`. A postal address is
   * deliberately not here: the founder has decided not to publish one.
   */
  operator: 'Wenna',
  /** Link and app host. Permanent once a link has left the founder — see above. */
  domain: 'wenna.app',
  /** Transactional sender. Mail goes out on a separate authenticated subdomain. */
  sender: 'Wenna <hello@mail.wenna.app>',
  /**
   * Replies land here: the `Reply-To` of every product email (S1-19). It must
   * reach a mailbox somebody reads, so it is forwarded to the founder's inbox
   * (SUS-99); an address that drops replies is worse than none.
   */
  supportEmail: 'hello@wenna.app',
  /**
   * Deep-link scheme for native universal/app links. Still the codename, on
   * purpose: see the top of this file.
   */
  scheme: 'circles',
} as const;

export type Brand = typeof brand;

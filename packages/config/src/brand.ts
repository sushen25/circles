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
 * `domain` is a **holding** domain on the founder's personal apex, chosen in
 * S0-11 so links could ship before the product has a name. It says what the
 * thing does rather than what it is called, so it stays true through the
 * rename. It will be replaced — SUS-99 moves it, the sender and the support
 * address to `wenna.app` once that is bought — and nothing may assume it. Links are never shipped
 * on `*.expo.app` (architecture §5.2).
 *
 * There is no matching non-production host. EAS Hosting allows one custom
 * domain per project and `meet` takes it, so `dev` stays on the `expo.app`
 * URL — which is fine, because nothing user-visible ever points at `dev`: it
 * arrives through `EXPO_PUBLIC_APP_ORIGIN`.
 *
 * Replacing the domain is expected and cheap **until the first invite link
 * reaches somebody who is not the founder**. After that the old host has to go
 * on answering for as long as links sitting in group chats matter, and EAS
 * serves only one custom domain per project, so that redirect has to live
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
  /** Link and app host. Holding domain — see above. */
  domain: 'meet.sushensatturu.com',
  /** Transactional sender. Mail goes out on a separate authenticated subdomain. */
  sender: 'Wenna <hello@mail.meet.sushensatturu.com>',
  /**
   * Replies land here. **Nothing receives mail at this address yet** — the
   * holding domain has no MX record. Set up forwarding before any email that
   * carries it is sent (S1-19), or a reply to a real person vanishes.
   */
  supportEmail: 'support@meet.sushensatturu.com',
  /**
   * Deep-link scheme for native universal/app links. Still the codename, on
   * purpose: see the top of this file.
   */
  scheme: 'circles',
} as const;

export type Brand = typeof brand;

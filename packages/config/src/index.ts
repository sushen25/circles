/**
 * `@circles/config` — brand constants (name, domain, sender) and consent
 * wording. Codename only: nothing here may assume the final product name
 * (architecture §5.4).
 *
 * It held feature flags too, for features whose server side had landed before
 * their screens. The last one, `quietAsk`, went with S2-03; add a flag back
 * only for a feature that is half-landed, and delete it in the ticket that
 * lands the other half.
 */
export const PACKAGE_NAME = '@circles/config';

export { brand } from './brand.js';
export type { Brand } from './brand.js';
export { CONSENT } from './consent.js';
export type { Consent } from './consent.js';

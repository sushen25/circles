/**
 * `@circles/config` — brand constants (name, domain, sender), feature flags and
 * the environment-variable schema. Codename only: nothing here may assume the
 * final product name (architecture §5.4). Feature flags and the environment
 * schema land in S0-11.
 */
export const PACKAGE_NAME = '@circles/config';

export { brand } from './brand.js';
export type { Brand } from './brand.js';

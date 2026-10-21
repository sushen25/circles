/**
 * The platforms the pull knows, by name (docs/analytics-plan.md, "Pull").
 * One module per file in this folder, each keeping the contract in
 * module.ts; this file is the only list of them, so adding a platform is
 * one file and one line here. A platform missing from the map (linkedin,
 * tiktok and reddit, until each has a module) is skipped by the pull,
 * `npm run posted` and `npm run tokens` with one line saying "no module
 * yet"; nothing guesses at it.
 */
import type { Platform } from '../../lib/queue.ts';
import type { PlatformModule } from './module.ts';
import { bluesky } from './bluesky.ts';
import { instagram } from './instagram.ts';
import { threads } from './threads.ts';
import { youtube } from './youtube.ts';

export const modules: Partial<Record<Platform, PlatformModule>> = { bluesky, instagram, threads, youtube };

export function moduleFor(platform: Platform): PlatformModule | undefined {
  return modules[platform];
}

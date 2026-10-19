import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEventName, isServerEvent, type EventName } from '@circles/contracts';
import { describe, expect, it } from 'vitest';

/**
 * Refusing a server-side fact at the ingest (SUS-185) must never refuse an
 * event the app genuinely sends: that would stop the measurement without a
 * sound. Every `track('name', ...)` in the app must name a client event.
 */
describe('the events the app sends', () => {
  it('are all client events, so the ingest takes them', () => {
    // Refusing one of these at the ingest would silently stop the measurement.
    // Every `track('name', …)` in the app must name a client event.
    const sent = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          for (const match of readFileSync(path, 'utf8').matchAll(/\btrack\(\s*'([a-z_]+)'/g)) {
            sent.add(match[1] as string);
          }
        }
      }
    };
    walk(join(dirname(fileURLToPath(import.meta.url)), '..'));
    expect(sent.size).toBeGreaterThan(20);
    for (const name of sent) {
      expect(isEventName(name), `${name} is declared`).toBe(true);
      expect(isServerEvent(name as EventName), `${name} is sent by the app`).toBe(false);
    }
  });
});

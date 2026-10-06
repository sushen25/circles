import { describe, expect, it } from 'vitest';

import { forgetJourneys, journeyGeneration, readJourney, writeJourney } from './journey';

/**
 * A journey is in memory and personal (SUS-162): it is forgotten at sign-out, and
 * nothing started before the sign-out can write it back.
 */
describe('journeys', () => {
  it('holds a value until it is forgotten', () => {
    writeJourney('k', { email: 'priya@example.com' });
    expect(readJourney('k')).toEqual({ email: 'priya@example.com' });

    forgetJourneys();

    expect(readJourney('k')).toBeUndefined();
  });

  it('drops a write from something that started before the sign-out', () => {
    const started = journeyGeneration();
    forgetJourneys();

    writeJourney('k', { email: 'priya@example.com' }, started);

    expect(readJourney('k')).toBeUndefined();
    writeJourney('k', { email: 'next@example.com' }, journeyGeneration());
    expect(readJourney('k')).toEqual({ email: 'next@example.com' });
  });
});

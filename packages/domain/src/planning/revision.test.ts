import { describe, expect, it } from 'vitest';

import { userId } from '../circles/types.js';
import { addMinutes } from '../shared/instant.js';
import { localDate } from '../shared/local-date.js';
import { plan } from './fixtures.js';
import { invalidatedResponses, invalidatingChanges, joinNames } from './revision.js';

const priya = userId('priya');
const tom = userId('tom');
const alex = userId('alex');
const members = [priya, tom, alex];

describe('invalidatingChanges', () => {
  const before = plan();

  it('sees a changed date window', () => {
    const after = plan({
      window: { start: localDate('2026-09-21'), end: localDate('2026-09-27') },
    });
    expect(invalidatingChanges(before, after)).toEqual(['window']);
  });

  it('sees a changed daily band', () => {
    const after = plan({ daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 } });
    expect(invalidatingChanges(before, after)).toEqual(['daily']);
  });

  it('sees a changed duration — a 3-hour meetup is a different question', () => {
    expect(invalidatingChanges(before, plan({ durationMinutes: 180 }))).toEqual(['duration']);
  });

  it('does not count quorum or deadline: they change what happens to the answers, not the question', () => {
    expect(invalidatingChanges(before, plan({ quorum: 2 }))).toEqual([]);
    expect(
      invalidatingChanges(
        before,
        plan({ responseDeadline: addMinutes(before.responseDeadline, 60) }),
      ),
    ).toEqual([]);
  });

  it('reports every change at once', () => {
    const after = plan({
      durationMinutes: 60,
      daily: { startMin: 9 * 60, endMin: 12 * 60 },
    });
    expect(invalidatingChanges(before, after)).toEqual(['daily', 'duration']);
  });
});

describe('invalidatedResponses', () => {
  const before = plan();
  const after = plan({ durationMinutes: 180 });

  it('asks the people who already answered to answer again', () => {
    const result = invalidatedResponses(before, after, members, [priya, tom]);
    expect(result.askedAgain).toEqual([priya, tom]);
    expect(result.bumpsRevision).toBe(true);
  });

  it('lists those who had not answered separately — being asked twice is a different imposition', () => {
    const result = invalidatedResponses(before, after, members, [priya, tom]);
    expect(result.freshAsk).toEqual([alex]);
  });

  it('costs nobody a reply when only the quorum moved', () => {
    const result = invalidatedResponses(before, plan({ quorum: 2 }), members, [priya, tom]);
    expect(result).toMatchObject({ askedAgain: [], freshAsk: [], bumpsRevision: false });
  });

  it('does not invent a revision when nothing changed at all', () => {
    expect(invalidatedResponses(before, plan(), members, members).bumpsRevision).toBe(false);
  });

  it('asks everybody again when the change is not one the timing shows', () => {
    // Reopening a confirmed plan: "Thursday is off the table" and "a fresh ask"
    // (spec §5.7). The timings are identical, and every answer is cleared all
    // the same — so a comparison of timings alone named nobody while costing
    // everybody, which is the warning being wrong about the most expensive edit
    // there is.
    const result = invalidatedResponses(before, plan(), members, [priya, tom], true);
    expect(result).toMatchObject({
      askedAgain: [priya, tom],
      freshAsk: [alex],
      changes: [],
      bumpsRevision: true,
    });
  });
});

describe('joinNames', () => {
  it('reads like a person wrote it', () => {
    expect(joinNames(['Priya', 'Tom', 'Jess'])).toBe('Priya, Tom and Jess');
    expect(joinNames(['Priya', 'Tom'])).toBe('Priya and Tom');
    expect(joinNames(['Priya'])).toBe('Priya');
  });

  it('is empty for nobody, so the caller can drop the clause entirely', () => {
    expect(joinNames([])).toBe('');
  });
});

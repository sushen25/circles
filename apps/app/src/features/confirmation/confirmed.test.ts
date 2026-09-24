import { afterEach, describe, expect, it } from 'vitest';

import { calendarFilename, confirmedOf, messageOf, myAttendanceOf } from './confirmed';
import { lockedIn, lockedInAsMember } from './fixtures';
import { fieldsOf } from './review';

/**
 * The confirmed screens' words, from Sunday Crew locked in (spec §5.7): the
 * counts both screens share, the message the organiser pastes, and which way a
 * member may move their answer.
 */

const confirmation = lockedIn.confirmation!;

describe('confirmedOf', () => {
  it('counts who is going and who has still to say, and names the one who has not', () => {
    const view = confirmedOf(lockedIn, confirmation);
    expect(view.counts).toBe('5 going · 1 to confirm');
    expect(view.unsaid).toBe("Alex hasn't said yet");
    expect(view.names).toBe('Maya, Priya and 3 others going · Alex to confirm');
    expect(view.timePlace).toMatch(/ · Hope St Radio$/);
    expect(view.note).toBe("Maya says: “Table's booked under my name. Come hungry.”");
  });

  it('draws the undecided dashed and leaves out whoever cannot come', () => {
    const view = confirmedOf(
      {
        ...lockedIn,
        attendance: lockedIn.attendance.map((a) =>
          a.userId === 'tom' ? { ...a, status: 'cant' as const } : a,
        ),
      },
      confirmation,
    );
    expect(view.counts).toBe("4 going · 1 can't make it · 1 to confirm");
    expect(view.members.map((m) => m.name)).not.toContain('Tom');
    expect(view.members.find((m) => m.name === 'Alex')?.waiting).toBe(true);
  });
});

describe('confirmedOf, away from home', () => {
  const home = process.env.TZ;
  afterEach(() => {
    if (home === undefined) delete process.env.TZ;
    else process.env.TZ = home;
  });

  it("names the circle's zone when this device is elsewhere, and only then (ADR 00XX)", () => {
    process.env.TZ = 'Australia/Melbourne';
    expect(confirmedOf(lockedIn, confirmation).zoneNote).toBeUndefined();
    process.env.TZ = 'Europe/London';
    expect(confirmedOf(lockedIn, confirmation).zoneNote).toBe('Times are Melbourne time.');
  });
});

describe('messageOf', () => {
  it("is the domain's locked-in sentence, with the plan's page and no secret", () => {
    const message = messageOf(lockedIn, confirmation, 'https://circles.test');
    expect(message).toMatch(/^Locked in: Sunday Crew, /);
    expect(message).toContain('at Hope St Radio.');
    expect(message).toMatch(/Details and add-to-calendar: https:\/\/circles\.test\/p\/pnsundaycr$/);
    expect(message).not.toContain('#');
  });
});

describe('calendarFilename', () => {
  it('is named for the local date, the name generate-ics gives the same file', () => {
    expect(calendarFilename(lockedIn, confirmation)).toBe('sunday-crew-2026-09-17.ics');
  });
});

describe('myAttendanceOf', () => {
  const before = new Date('2026-09-16T00:00:00Z');

  it('lets somebody going say they cannot, and nothing else', () => {
    expect(myAttendanceOf(lockedInAsMember, confirmation, before)).toEqual({
      status: 'going',
      canGo: false,
      canCant: true,
    });
  });

  it('offers both to somebody who has not said', () => {
    const alex = { ...lockedInAsMember, me: 'alex' };
    expect(myAttendanceOf(alex, confirmation, before)).toMatchObject({
      canGo: true,
      canCant: true,
    });
  });

  // The answer is corrected on the database's say-so, not this device's: a
  // phone whose clock is days ahead still offers both ways.
  it("offers the correction whatever this device's clock says", () => {
    const farAhead = new Date('2030-01-01T00:00:00Z');
    expect(myAttendanceOf(lockedInAsMember, confirmation, farAhead)).toMatchObject({
      canCant: true,
    });
    const alex = { ...lockedInAsMember, me: 'alex' };
    expect(myAttendanceOf(alex, confirmation, farAhead)).toMatchObject({
      canGo: true,
      canCant: true,
    });
  });

  it('has nothing for somebody who was never asked', () => {
    expect(myAttendanceOf({ ...lockedInAsMember, me: 'ren' }, confirmation, before)).toBe(
      undefined,
    );
  });
});

describe('fieldsOf', () => {
  it('refuses a map link that is not a link, as the contract would', () => {
    const fields = fieldsOf({ placeName: '', placeUrl: 'javascript:alert(1)', note: '' });
    expect(fields.valid).toBe(false);
    expect(fields.placeUrlError).toMatch(/https:\/\//);
  });

  it('refuses a link longer than the request takes, rather than failing on send', () => {
    const fields = fieldsOf({
      placeName: '',
      placeUrl: `https://maps.example/${'a'.repeat(2048)}`,
      note: '',
    });
    expect(fields.valid).toBe(false);
    expect(fields.placeUrlError).toBeDefined();
  });

  it('sends nothing for an empty field, and counts the note against 280', () => {
    const fields = fieldsOf({ placeName: ' ', placeUrl: '', note: 'Come hungry.' });
    expect(fields).toMatchObject({ placeName: undefined, placeUrl: undefined, valid: true });
    expect(fields.noteCount).toBe('12 of 280');
  });
});

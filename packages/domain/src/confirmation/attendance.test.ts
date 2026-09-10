import { describe, expect, it } from 'vitest';

import { userId } from '../circles/types.js';
import { ALEX, JESS, NIC, PRIYA, SAM, SUNDAY_CREW, TOM } from '../scheduling/fixtures.js';
import { fromISO } from '../shared/instant.js';
import {
  applyAttendance,
  attendanceCounts,
  awaitingReply,
  canUpdateAttendance,
  deriveAttendance,
  updateAttendance,
} from './attendance.js';
import { confirmation, sundayCrewPlan, sundayCrewStoredResponses } from './fixtures.js';
import type { AttendanceChoice, AttendanceStatus } from './types.js';

const CHOICES: readonly AttendanceChoice[] = ['going', 'cant', 'was_there', 'missed'];
const STATUSES: readonly AttendanceStatus[] = ['unknown', 'going', 'cant', 'was_there', 'missed'];

describe('deriveAttendance', () => {
  const plan = sundayCrewPlan();
  const attendances = deriveAttendance(
    confirmation(),
    sundayCrewStoredResponses(plan),
    SUNDAY_CREW,
  );

  it('says 5 going and 1 to confirm, exactly as the ConfirmedOrg artboard does', () => {
    const counts = attendanceCounts(attendances);
    expect(counts.going).toBe(5);
    expect(counts.unknown).toBe(1);
    expect(counts.cant).toBe(0);
    expect(awaitingReply(attendances)).toEqual([ALEX]);
  });

  it('nobody has to re-confirm what their availability already said', () => {
    // Everyone whose windows fit the confirmed time is already going, in the
    // members-list order the marks render in.
    const going = attendances.filter((a) => a.status === 'going').map((a) => a.userId);
    expect(going).toEqual([SAM, PRIYA, TOM, JESS, NIC]);
  });

  it('marks someone who answered but cannot make this time as cant, not unknown', () => {
    // Priya answered, and is dropped from the frozen available set.
    const withoutPriya = confirmation({
      candidate: {
        ...confirmation().candidate,
        availableUserIds: confirmation().candidate.availableUserIds.filter((id) => id !== PRIYA),
      },
    });
    const derived = deriveAttendance(withoutPriya, sundayCrewStoredResponses(plan), SUNDAY_CREW);
    expect(derived.find((a) => a.userId === PRIYA)?.status).toBe('cant');
    expect(derived.find((a) => a.userId === ALEX)?.status).toBe('unknown');
  });

  it('ignores answers from another revision, which an edit already invalidated', () => {
    const stale = sundayCrewStoredResponses(plan).map((r) => ({ ...r, revision: r.revision - 1 }));
    const derived = deriveAttendance(
      confirmation({
        candidate: { ...confirmation().candidate, availableUserIds: [] },
      }),
      stale,
      SUNDAY_CREW,
    );
    // Nobody is available and nobody's answer counts, so everyone is unknown —
    // not `cant`, which would tell five people they had declined.
    expect(attendanceCounts(derived).unknown).toBe(SUNDAY_CREW.length);
  });

  it('carries the confirmation time rather than inventing one', () => {
    for (const attendance of attendances) {
      expect(attendance.updatedAt).toBe(confirmation().confirmedAt);
      expect(attendance.confirmationId).toBe(confirmation().id);
    }
  });

  it('covers every active member, including one who never responded at all', () => {
    const withNewcomer = deriveAttendance(confirmation(), sundayCrewStoredResponses(plan), [
      ...SUNDAY_CREW,
      userId('user-newcomer'),
    ]);
    expect(withNewcomer).toHaveLength(SUNDAY_CREW.length + 1);
    expect(withNewcomer.at(-1)?.status).toBe('unknown');
  });
});

describe('updateAttendance', () => {
  it('lets someone change their mind before the meetup, in both directions', () => {
    expect(updateAttendance('going', 'cant')).toEqual({ ok: true, value: 'cant' });
    expect(updateAttendance('cant', 'going')).toEqual({ ok: true, value: 'going' });
  });

  it('lets someone who never answered say anything', () => {
    for (const choice of CHOICES) expect(canUpdateAttendance('unknown', choice)).toBe(true);
  });

  it('never turns an answer about the past back into a promise about the future', () => {
    // The WasThere screen is a different question from the confirmed screen.
    for (const past of ['was_there', 'missed'] as const) {
      expect(canUpdateAttendance(past, 'going')).toBe(false);
      expect(canUpdateAttendance(past, 'cant')).toBe(false);
    }
    expect(updateAttendance('was_there', 'going')).toEqual({
      ok: false,
      error: { code: 'attendance_not_reversible', from: 'was_there', to: 'going' },
    });
  });

  it('lets someone correct a mis-tap on the WasThere screen', () => {
    expect(updateAttendance('was_there', 'missed')).toEqual({ ok: true, value: 'missed' });
    expect(updateAttendance('missed', 'was_there')).toEqual({ ok: true, value: 'was_there' });
  });

  it('treats choosing what you already are as a success, not an error', () => {
    for (const status of STATUSES) {
      if (status === 'unknown') continue;
      expect(updateAttendance(status, status)).toEqual({ ok: true, value: status });
    }
  });

  it('never lets a member set themselves back to unknown', () => {
    // `unknown` means "has not said", which is not something you can say.
    for (const status of STATUSES) {
      // @ts-expect-error `unknown` is not an `AttendanceChoice`, which is the point.
      expect(canUpdateAttendance(status, 'unknown')).toBe(status === 'unknown');
    }
  });
});

describe('applyAttendance', () => {
  const attendance = {
    confirmationId: confirmation().id,
    userId: SAM,
    status: 'going' as const,
    updatedAt: fromISO('2026-09-14T09:00:00Z'),
  };

  it('stamps the change with the time it was made', () => {
    const now = fromISO('2026-09-16T02:00:00Z');
    const result = applyAttendance(attendance, 'cant', now);
    expect(result.ok && result.value).toEqual({ ...attendance, status: 'cant', updatedAt: now });
  });

  it('passes a refusal through untouched, leaving the row alone', () => {
    const result = applyAttendance(
      { ...attendance, status: 'was_there' },
      'going',
      fromISO('2026-09-18T00:00:00Z'),
    );
    expect(result.ok).toBe(false);
  });
});

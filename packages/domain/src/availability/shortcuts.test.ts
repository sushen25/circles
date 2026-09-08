import { describe, expect, it } from 'vitest';

import { plan } from '../planning/fixtures.js';
import { MELBOURNE } from '../shared/fixtures.js';
import type { Interval } from '../shared/interval.js';
import { localDate } from '../shared/local-date.js';
import { toLocal } from '../shared/zone.js';
import { applyShortcut, availableShortcuts } from './shortcuts.js';

const DAY = localDate('2026-09-17');
const band = (i: Interval | undefined) =>
  i === undefined
    ? undefined
    : [toLocal(i.start, MELBOURNE).minutesOfDay, toLocal(i.end, MELBOURNE).minutesOfDay];

describe('on a weekday evening plan (17:30–22:30)', () => {
  const p = plan();

  it('after work is the whole evening the plan asks about', () => {
    expect(band(applyShortcut('after_work', DAY, p))).toEqual([17 * 60 + 30, 22 * 60 + 30]);
  });

  it('all evening is clamped to the band rather than running to midnight', () => {
    expect(band(applyShortcut('all_evening', DAY, p))).toEqual([17 * 60 + 30, 22 * 60 + 30]);
  });

  it('any time is the whole band', () => {
    expect(band(applyShortcut('any_time', DAY, p))).toEqual([17 * 60 + 30, 22 * 60 + 30]);
  });

  it('offers nothing for morning or afternoon, rather than something outside the plan', () => {
    expect(applyShortcut('morning', DAY, p)).toBeUndefined();
    expect(applyShortcut('afternoon', DAY, p)).toBeUndefined();
  });

  it('lists only the shortcuts that can do something, so the UI hides the rest', () => {
    expect(availableShortcuts(DAY, p).sort()).toEqual(['after_work', 'all_evening', 'any_time']);
  });
});

describe('on a weekend day plan (09:00–22:30)', () => {
  const p = plan({ daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 } });

  it('morning and afternoon now mean something', () => {
    expect(band(applyShortcut('morning', DAY, p))).toEqual([9 * 60, 12 * 60]);
    expect(band(applyShortcut('afternoon', DAY, p))).toEqual([12 * 60, 17 * 60]);
  });

  it('any time is the whole thirteen and a half hours', () => {
    expect(band(applyShortcut('any_time', DAY, p))).toEqual([9 * 60, 22 * 60 + 30]);
  });

  it('offers every shortcut', () => {
    expect(availableShortcuts(DAY, p)).toHaveLength(5);
  });
});

describe('on a narrow plan', () => {
  it('clips a shortcut to the band rather than exceeding it', () => {
    const p = plan({ daily: { startMin: 19 * 60, endMin: 20 * 60 } });
    expect(band(applyShortcut('after_work', DAY, p))).toEqual([19 * 60, 20 * 60]);
  });

  it('offers no morning shortcut on an evening-only plan', () => {
    const p = plan({ daily: { startMin: 19 * 60, endMin: 20 * 60 } });
    expect(applyShortcut('morning', DAY, p)).toBeUndefined();
  });
});

describe('across a daylight-saving change', () => {
  it('keeps the local hours people were shown', () => {
    const p = plan({ window: { start: localDate('2026-10-04'), end: localDate('2026-10-04') } });
    expect(band(applyShortcut('after_work', localDate('2026-10-04'), p))).toEqual([
      17 * 60 + 30,
      22 * 60 + 30,
    ]);
  });
});

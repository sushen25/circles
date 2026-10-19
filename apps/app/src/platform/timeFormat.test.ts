import { afterEach, describe, expect, it, vi } from 'vitest';

import { timeOfDay } from '../features/availability/words';
import { defaultTimeFormatter, rangeLabel } from '../components/availability';
import { deviceTimeFormat } from './timeFormat';

/** The device clock, faked: what `Intl` would resolve on a 12- or 24-hour phone. */
function clock(hour12: boolean) {
  const real = Intl.DateTimeFormat;
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((...args: unknown[]) => {
    const format = new real(...(args as ConstructorParameters<typeof real>));
    const resolved = format.resolvedOptions.bind(format);
    format.resolvedOptions = () => ({ ...resolved(), hour12 });
    return format;
  }) as unknown as typeof Intl.DateTimeFormat);
}

afterEach(() => vi.restoreAllMocks());

describe('every time on the device clock, written one way', () => {
  it('12-hour: lowercase "6:30 pm", no padding', () => {
    clock(true);
    expect(deviceTimeFormat()).toEqual({ hour12: true });
    expect(defaultTimeFormatter()(18 * 60 + 30)).toBe('6:30 pm');
    expect(rangeLabel([false, false, true, true], 17 * 60 + 30)).toBe('6:30–7:30 pm');
    expect(timeOfDay(new Date(2026, 8, 17, 9, 5).toISOString())).toBe('9:05 am');
  });

  it('24-hour: padded "18:30"', () => {
    clock(false);
    expect(deviceTimeFormat()).toEqual({ hour12: false });
    expect(defaultTimeFormatter()(9 * 60)).toBe('09:00');
    expect(rangeLabel([false, false, true, true], 17 * 60 + 30)).toBe('18:30–19:30');
    expect(timeOfDay(new Date(2026, 8, 17, 9, 5).toISOString())).toBe('09:05');
  });
});

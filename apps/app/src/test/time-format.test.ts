import { afterEach, describe, expect, it, vi } from 'vitest';

import { timeOfDay } from '../features/availability/words';
import { rangeLabel } from '../components/availability';
import { deviceTimeFormat, deviceTimeFormatter } from '../platform/timeFormat';

/** The device clock, faked: what `Intl` would resolve on a 12- or 24-hour phone. */
function clock(hour12: boolean | undefined, hourCycle?: string) {
  const real = Intl.DateTimeFormat;
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((...args: unknown[]) => {
    const format = new real(...(args as ConstructorParameters<typeof real>));
    const resolved = format.resolvedOptions.bind(format);
    format.resolvedOptions = () =>
      ({ ...resolved(), hour12, hourCycle }) as Intl.ResolvedDateTimeFormatOptions;
    return format;
  }) as unknown as typeof Intl.DateTimeFormat);
}

afterEach(() => vi.restoreAllMocks());

describe('every time on the device clock, written one way', () => {
  it('12-hour: lowercase "6:30 pm", no padding', () => {
    clock(true);
    expect(deviceTimeFormat()).toEqual({ hour12: true });
    expect(deviceTimeFormatter()(18 * 60 + 30)).toBe('6:30 pm');
    expect(rangeLabel([false, false, true, true], 17 * 60 + 30, deviceTimeFormatter())).toBe(
      '6:30–7:30 pm',
    );
    expect(timeOfDay(new Date(2026, 8, 17, 9, 5).toISOString())).toBe('9:05 am');
  });

  it('24-hour: padded "18:30"', () => {
    clock(false);
    expect(deviceTimeFormat()).toEqual({ hour12: false });
    expect(deviceTimeFormatter()(9 * 60)).toBe('09:00');
    expect(rangeLabel([false, false, true, true], 17 * 60 + 30, deviceTimeFormatter())).toBe(
      '18:30–19:30',
    );
    expect(timeOfDay(new Date(2026, 8, 17, 9, 5).toISOString())).toBe('09:05');
  });

  it('midnight: "12:05 am" and "00:05", and a range to the end of the day', () => {
    clock(true);
    expect(timeOfDay(new Date(2026, 8, 17, 0, 5).toISOString())).toBe('12:05 am');
    vi.restoreAllMocks();
    clock(false);
    expect(timeOfDay(new Date(2026, 8, 17, 0, 5).toISOString())).toBe('00:05');
    expect(rangeLabel([true, true], 23 * 60, deviceTimeFormatter())).toBe('23:00–00:00');
  });

  it('reads hourCycle when the runtime gives no hour12', () => {
    clock(undefined, 'h23');
    expect(deviceTimeFormat()).toEqual({ hour12: false });
    vi.restoreAllMocks();
    clock(undefined, 'h12');
    expect(deviceTimeFormat()).toEqual({ hour12: true });
  });
});

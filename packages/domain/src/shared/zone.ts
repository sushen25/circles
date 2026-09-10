import { fromZonedTime } from 'date-fns-tz';

import { type Instant, MINUTE_MILLIS, instant } from './instant.js';
import { type LocalDate, fromParts, localDate } from './local-date.js';

/**
 * The only file in the domain that knows what a time zone is.
 *
 * Everything else works in `Instant` (absolute) or `LocalDate` +
 * `minutesOfDay` (what a person reads on a clock). These two functions are the
 * bridge, and they are the only place `date-fns-tz` may be imported — a lint
 * rule enforces it, so a zone conversion cannot quietly appear in the middle of
 * the candidate engine.
 *
 * Reading a zone offset uses `Intl`, which carries the tz database the runtime
 * already trusts; writing one uses `date-fns-tz`. The policies for the two
 * awkward days of the year are ours, stated below, not the library's.
 */
export type Zone = string & { readonly __brand: 'Zone' };

export function zone(value: string): Zone {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
  } catch {
    throw new RangeError(`Not an IANA time zone: ${value}`);
  }
  return value as Zone;
}

export type LocalTime = {
  date: LocalDate;
  /** Minutes since local midnight. 18:30 is 1110. */
  minutesOfDay: number;
};

const PARTS = new Map<string, Intl.DateTimeFormat>();

function formatter(z: Zone): Intl.DateTimeFormat {
  let existing = PARTS.get(z);
  if (!existing) {
    existing = new Intl.DateTimeFormat('en-GB', {
      timeZone: z,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    PARTS.set(z, existing);
  }
  return existing;
}

/** What a clock in `z` reads at this moment. Always defined, always unambiguous. */
export function toLocal(value: Instant, z: Zone): LocalTime {
  const parts = formatter(z).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);

  // `hour12: false` yields hour 24 for midnight in some runtimes.
  const hour = get('hour') % 24;

  return {
    date: fromParts(get('year'), get('month'), get('day')),
    minutesOfDay: hour * 60 + get('minute'),
  };
}

/**
 * The zone's offset from UTC at this moment, in minutes.
 *
 * Compared at whole-minute precision on purpose. `toLocal` reports minutes of
 * the day and drops anything finer, so seconds or milliseconds in `value` would
 * skew the difference and round to a neighbouring minute — Melbourne read as
 * +599 rather than +600 for an instant carrying half a second. Offsets only
 * ever change on a minute boundary, so flooring first loses nothing.
 */
export function offsetMinutes(value: Instant, z: Zone): number {
  const atMinute = Math.floor(value / MINUTE_MILLIS) * MINUTE_MILLIS;
  const local = toLocal(instant(atMinute), z);
  const { year, month, day } = splitDate(local.date);
  const asIfUtc = Date.UTC(year, month - 1, day) + local.minutesOfDay * MINUTE_MILLIS;
  return Math.round((asIfUtc - atMinute) / MINUTE_MILLIS);
}

function splitDate(date: LocalDate): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-') as [string, string, string];
  return { year: Number(y), month: Number(m), day: Number(d) };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The moment a clock in `z` reads this wall time.
 *
 * Twice a year a wall time is not a moment, and the product has to pick one:
 *
 * - **Gap** (clocks spring forward — Melbourne, first Sunday in October, 02:00
 *   becomes 03:00). 02:30 never happens. We **skip forward** to the first
 *   moment after the gap, so a plan window that starts at 02:00 still starts.
 *   Refusing would strand a plan on a date nobody chose deliberately.
 * - **Overlap** (clocks fall back — Melbourne, first Sunday in April, 03:00
 *   becomes 02:00). 02:30 happens twice. We take the **first occurrence**, the
 *   earlier moment, because a person who says "half two" on that morning means
 *   the first one they will live through.
 *
 * Both are asserted in `zone.test.ts` against real Melbourne and Adelaide
 * transitions rather than trusted to the library.
 */
export function fromLocal(date: LocalDate, minutesOfDay: number, z: Zone): Instant {
  if (!Number.isInteger(minutesOfDay) || minutesOfDay < 0 || minutesOfDay >= 24 * 60) {
    throw new RangeError(`minutesOfDay out of range: ${minutesOfDay}`);
  }

  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  const wall = `${date}T${pad(hours)}:${pad(minutes)}:00`;

  const candidate = instant(fromZonedTime(wall, z).getTime());

  // Did we land on the wall time we asked for?
  const landed = toLocal(candidate, z);
  const exact = landed.date === date && landed.minutesOfDay === minutesOfDay;

  if (!exact) {
    // A gap: the wall time does not exist. Skip forward to the first moment
    // whose local time is past the one requested.
    return firstMomentAfterGap(date, minutesOfDay, z, candidate);
  }

  // An overlap: an earlier moment may read the same wall time. Prefer it.
  const anHourEarlier = instant(candidate - 60 * MINUTE_MILLIS);
  const earlier = toLocal(anHourEarlier, z);
  if (earlier.date === date && earlier.minutesOfDay === minutesOfDay) {
    return anHourEarlier;
  }

  return candidate;
}

/**
 * Walk forward in five-minute steps from the start of the gap. Transitions are
 * at most a couple of hours and always land on a five-minute boundary, so this
 * terminates quickly and needs no knowledge of the transition itself.
 */
function firstMomentAfterGap(
  date: LocalDate,
  minutesOfDay: number,
  z: Zone,
  from: Instant,
): Instant {
  const step = 5 * MINUTE_MILLIS;
  let probe = instant(from - 3 * 60 * MINUTE_MILLIS);
  const limit = instant(from + 6 * 60 * MINUTE_MILLIS);

  while (probe <= limit) {
    const local = toLocal(probe, z);
    const past = local.date > date || (local.date === date && local.minutesOfDay >= minutesOfDay);
    if (past) return probe;
    probe = instant(probe + step);
  }

  // Unreachable for any real zone; better to say so than to return a wrong moment.
  throw new RangeError(`Could not resolve ${date} ${minutesOfDay} in ${z}`);
}

/** Convenience for the common case of a whole hour. */
export function atLocalTime(date: string, minutesOfDay: number, timeZone: string): Instant {
  return fromLocal(localDate(date), minutesOfDay, zone(timeZone));
}

/**
 * Half-hour boundaries **as a local clock shows them**.
 *
 * Not the same as boundaries measured from the Unix epoch. Most zones are
 * offset from UTC by a whole or half hour, so the two coincide and the
 * distinction never shows — but `Asia/Kathmandu` is +05:45 and `Pacific/Chatham`
 * is +12:45, and there a locally tidy 09:00 sits at 03:15 UTC. Rounding such a
 * window to epoch boundaries turns 09:00–10:00 into 09:15–09:45, silently
 * discarding half of what somebody offered.
 *
 * The grid a person paints on is built from local times (`availability/cells`),
 * so local is the only alignment that matches what they saw.
 */
const SLOT_MINUTES = 30;
const SLOT_MILLIS = SLOT_MINUTES * MINUTE_MILLIS;

/**
 * Rounds on a local timeline built from the offset **at the input instant**,
 * rather than by going through `toLocal` and back.
 *
 * The round trip loses information. When the clocks go back, a wall-clock time
 * happens twice, `toLocal` cannot say which one it was, and `fromLocal` always
 * rebuilds the first — so the second 02:15 rounded *up* to the first 02:30,
 * forty-five minutes earlier than where it started. A window start moving
 * backwards invents availability nobody offered.
 *
 * Holding the offset fixed keeps the occurrence, and keeps the ordering the
 * names promise: floor never exceeds its input, ceil never precedes it.
 *
 * Where the rounded boundary lands the other side of a transition, the result
 * follows the same skip-forward rule as `fromLocal` — it is the first real
 * moment at or after the wall time asked for.
 */
function roundLocal(value: Instant, z: Zone, round: (slots: number) => number): Instant {
  const offset = offsetMinutes(value, z) * MINUTE_MILLIS;
  const onLocalTimeline = value + offset;
  return instant(round(onLocalTimeline / SLOT_MILLIS) * SLOT_MILLIS - offset);
}

/** Down to the previous local half hour. */
export function floorToLocalSlot(value: Instant, z: Zone): Instant {
  return roundLocal(value, z, Math.floor);
}

/** Up to the next local half hour. */
export function ceilToLocalSlot(value: Instant, z: Zone): Instant {
  return roundLocal(value, z, Math.ceil);
}

/**
 * Every moment in `[from, to)` whose local clock reads a half hour, in order.
 *
 * The count is not `(to - from) / 30 minutes`: on the day the clocks go forward
 * some half hours do not happen, and on the day they go back two of them happen
 * twice. Walking the local clock is the only way to get the real ones — and the
 * painter's grid and the engine's start list have to agree about which exist,
 * so they share this rather than each computing it.
 */
export function localSlotStarts(from: Instant, to: Instant, z: Zone): Instant[] {
  const starts: Instant[] = [];
  let at = isAlignedToLocalSlot(from, z) ? from : ceilToLocalSlot(from, z);

  while (at < to) {
    starts.push(at);
    // A millisecond past the boundary so `ceil` moves on rather than standing
    // still. It keeps the occurrence, so a repeated hour yields both.
    const next = ceilToLocalSlot(instant(at + 1), z);
    if (next <= at) break; // defensive: the clock is not advancing
    at = next;
  }
  return starts;
}

/**
 * Whether the moment falls exactly on a local half-hour boundary.
 *
 * The sub-minute remainder is part of the question. `toLocal` reports minutes
 * of the day and discards anything finer, so checking only its output called
 * 18:30:45 aligned — and callers use this to enforce the invariant that willing
 * windows sit on half hours, so a malformed endpoint would have passed.
 */
export function isAlignedToLocalSlot(value: Instant, z: Zone): boolean {
  if (value % MINUTE_MILLIS !== 0) return false;
  return toLocal(value, z).minutesOfDay % SLOT_MINUTES === 0;
}

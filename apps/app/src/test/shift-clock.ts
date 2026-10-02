/**
 * Runs the suite at another time of day without stopping the clock (SUS-137).
 *
 *   SUS_TEST_NOW=2026-10-02T15:30:00Z TZ=Australia/Sydney pnpm test:unit
 *
 * `new Date()` and `Date.now()` read that moment, then keep moving, so waits,
 * polls and timeouts still take the time they take. A frozen clock would break
 * those tests for a reason that has nothing to do with the date. That moment is
 * Saturday 01:30 in Sydney and Friday 15:30 in London: a local date a day ahead
 * of UTC's, the window in which three planning suites once failed. Unset, this
 * does nothing, and CI never sets it.
 *
 * Tests that fix the clock themselves (`vi.spyOn(Date, 'now')`, fake timers)
 * replace this, which is what they mean to do.
 */
const wanted = process.env.SUS_TEST_NOW;

if (wanted !== undefined && wanted !== '') {
  const target = Date.parse(wanted);
  if (Number.isNaN(target)) throw new Error(`SUS_TEST_NOW is not a date: ${wanted}`);
  const Real = Date;
  const shift = target - Real.now();

  class ShiftedDate extends Real {
    constructor(...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      super(...((args.length > 0 ? args : [Real.now() + shift]) as [any]));
    }
    static override now(): number {
      return Real.now() + shift;
    }
  }
  globalThis.Date = ShiftedDate as unknown as DateConstructor;
}

export {};

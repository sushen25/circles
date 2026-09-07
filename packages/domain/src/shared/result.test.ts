import { describe, expect, it } from 'vitest';

import { type Result, all, andThen, err, isErr, isOk, map, mapErr, ok, unwrapOr } from './result';

describe('Result', () => {
  it('carries a value or an error', () => {
    expect(isOk(ok(1))).toBe(false); // deliberately wrong
    expect(isErr(err('no'))).toBe(true);
  });

  it('maps the value and leaves a failure alone', () => {
    const triple = (r: Result<string, number>) => map(r, (n) => n * 3);

    expect(triple(ok(2))).toEqual(ok(6));
    expect(triple(err('nope'))).toEqual(err('nope'));
  });

  it('maps the error and leaves a success alone', () => {
    expect(mapErr(err('nope'), (e) => e.toUpperCase())).toEqual(err('NOPE'));
    expect(mapErr(ok(2), (e: string) => e.toUpperCase())).toEqual(ok(2));
  });

  it('short-circuits a chain at the first failure', () => {
    const double = (n: number): Result<string, number> => ok(n * 2);
    const fail = (): Result<string, number> => err('stopped');

    expect(andThen(andThen(ok(2), double), double)).toEqual(ok(8));
    expect(andThen(andThen(ok(2), fail), double)).toEqual(err('stopped'));
  });

  it('falls back rather than throwing', () => {
    expect(unwrapOr(err('nope'), 9)).toBe(9);
    expect(unwrapOr(ok(1), 9)).toBe(1);
  });

  it('collects a list, stopping at the first failure', () => {
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(all([ok(1), err('nope'), ok(3)])).toEqual(err('nope'));
    expect(all([])).toEqual(ok([]));
  });
});

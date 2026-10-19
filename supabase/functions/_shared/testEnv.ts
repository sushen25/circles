/**
 * The function tests share one process (`singleFork`, see `vitest.config.ts`),
 * so `process.env` is shared between files. A file that sets a variable for its
 * own tests must not leave it for the next file: `CIRCLES_ENV=local` left behind
 * made `resend.test.ts` fail whenever it ran after a handler suite (SUS-239).
 *
 * Call this once at the top level of a test file and hand the result to
 * `afterAll`: `afterAll(envSnapshot())`. It snapshots the environment as the
 * file found it, and the returned function puts that back.
 */
export function envSnapshot(): () => void {
  const before = { ...process.env };
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in before)) delete process.env[key];
    }
    Object.assign(process.env, before);
  };
}

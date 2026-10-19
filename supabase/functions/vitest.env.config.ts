import { afterAll } from 'vitest';

// A setup file, run before every test file (see `vitest.config.ts`).
//
// The function tests share one process (`singleFork`), so `process.env` is
// shared between files. A file that sets a variable for its own tests must not
// leave it for the next one: `CIRCLES_ENV=local` left behind made
// `resend.test.ts` fail whenever it ran after a handler suite (SUS-239). This
// puts the environment back to what the file found, for every file, so a new
// test file cannot forget to.
const before = { ...process.env };

afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in before)) delete process.env[key];
  }
  Object.assign(process.env, before);
});

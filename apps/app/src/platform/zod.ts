import { z } from 'zod';

/**
 * Zod without code generation (SUS-119).
 *
 * Zod 4 compiles each object schema into a function with `new Function` to
 * parse faster, and finds out whether it may by trying one. The page's
 * Content-Security-Policy does not allow `eval` (it is the point of the
 * policy), so the try is refused: caught and harmless, but the browser logs a
 * policy violation on every page load, and a console that always has a
 * violation in it hides the one that matters. `jitless` skips the try and uses
 * the plain interpreter. The schemas here parse a handful of small objects, not
 * a stream.
 *
 * A side-effect module, imported first by `index.ts`: the check is made when
 * the first object schema is built, and the schemas are built when their
 * modules load.
 */
z.config({ jitless: true });

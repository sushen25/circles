import { IdempotencyKey, Problem } from '@circles/contracts';
import type { z } from 'zod';

import { authClient } from './auth/client';

/**
 * Calling an Edge Function, and reading why it said no (architecture §9.1).
 *
 * Every mutation in the product goes through one of these, and every screen
 * that calls one branches on the same thing: `Problem.reason`, never the
 * message. The message is copy for a person; the reason is the contract. So the
 * error this throws carries the parsed Problem, or nothing when there was no
 * answer to parse — a dropped connection is not a refusal, and the two need
 * different screens.
 */

export class FunctionError extends Error {
  constructor(
    /** What the server said, when it said something. Undefined means no answer. */
    readonly problem: Problem | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'FunctionError';
  }

  /** The precise cause, when the server gave one a screen can act on. */
  get reason(): Problem['reason'] {
    return this.problem?.reason;
  }

  /** The short id a person can read back to us ("Ref 7F3K-2Q"). */
  get reference(): string | undefined {
    return this.problem?.reference;
  }
}

/** A fresh key for a new request. Reuse it for a retry of *that* request (ADR 0016). */
export function newIdempotencyKey(): IdempotencyKey {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid === undefined) throw new Error('no crypto.randomUUID available');
  return IdempotencyKey.parse(uuid);
}

/** `functions.invoke` gives back a `Response` on failure; the body is the Problem. */
export async function problemOf(error: unknown): Promise<Problem | undefined> {
  const response = (error as { context?: unknown })?.context;
  if (!(response instanceof Response)) return undefined;
  try {
    const parsed = Problem.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Calls `name` with `body` and parses the answer with `response`.
 *
 * The function's name goes into the error message and nothing from the body
 * does: bodies here carry invite secrets and re-entry tokens, and an exception
 * message is a thing that ends up in a log (non-negotiable 8).
 */
export async function invokeFunction<T extends z.ZodType>(
  name: string,
  body: Record<string, unknown>,
  response: T,
): Promise<z.infer<T>> {
  const { data, error } = await authClient().functions.invoke(name, { body });
  if (error !== null) {
    const problem = await problemOf(error);
    throw new FunctionError(problem, problem?.message ?? `${name} failed`);
  }
  return response.parse(data);
}

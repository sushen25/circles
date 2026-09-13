/**
 * The slice of Deno these functions actually use.
 *
 * Written by hand, which the repository otherwise forbids for *table* types
 * (non-negotiable 3) — this is not one. The alternative is pulling Deno's full
 * type package into a pnpm workspace that otherwise targets Node, to describe
 * two members. Two members, declared where they are used, cost less than the
 * dependency and go stale more loudly.
 */
declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}

/**
 * A stable digest of the engine's input.
 *
 * Its one job is stale-result detection: `recalculate-candidates` computes a
 * set, and by the time it writes it the plan may have been edited or a response
 * withdrawn. Comparing hashes is how it notices (§12, S1-16).
 *
 * **Not a security hash.** No secret goes near it and nothing trusts it against
 * an adversary — FNV-1a over a canonical string is enough to notice a change,
 * runs synchronously in Deno and the browser alike, and needs no crypto import
 * in a package that is meant to stay pure.
 *
 * The serialisation is canonical rather than `JSON.stringify` of the input:
 * responses are sorted by member id and windows by start, so the same answers
 * hash the same however the caller assembled them. That is the same reason
 * `EngineInput.responses` is a sorted array of entries and not a `Map`.
 */

import type { EngineInput } from './types.js';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  // >>> 0 makes it unsigned; base 36 keeps it short enough to read in a log.
  return (hash >>> 0).toString(36);
}

export function canonicalise(input: EngineInput): string {
  const { plan } = input;

  const responses = [...input.responses]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([userId, response]) => {
      const windows = [...response.windows]
        .sort((x, y) => x.start - y.start || x.end - y.end)
        .map((w) => `${w.start}-${w.end}`)
        .join(',');
      return `${userId}:${response.status}:${windows}`;
    })
    .join('|');

  return [
    `v${plan.window.start}/${plan.window.end}`,
    `d${plan.daily.startMin}-${plan.daily.endMin}`,
    `z${plan.zone}`,
    `m${plan.durationMinutes}`,
    `q${plan.quorum}`,
    `r${[...plan.requiredMemberIds].sort().join(',')}`,
    // In order, not sorted. The members list order is what every set the engine
    // returns is ordered by, so reordering it changes the answer — which makes
    // it part of the input rather than a detail of how the caller assembled it.
    // `requiredMemberIds` above is genuinely a set: the engine sorts what it
    // derives from that one into this same order.
    `a${input.activeMemberIds.join(',')}`,
    `n${input.now}`,
    responses,
  ].join('~');
}

export function inputHash(input: EngineInput): string {
  return fnv1a(canonicalise(input));
}

/**
 * SHA-256, and the two shapes the rest of the kit needs it in.
 *
 * Digests are how secrets stop being secrets on their way into the database:
 * the invite fragment, the re-entry token and the IP address behind a rate
 * limit are all hashed here and never travel further as themselves (§14).
 */

export async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

/**
 * `\x…`, which is how PostgREST accepts a `bytea`. Hex rather than base64
 * because Postgres reads that form without a cast.
 */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = await sha256(value);
  return `\\x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

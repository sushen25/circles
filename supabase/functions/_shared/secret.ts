/**
 * A capability nobody can guess.
 *
 * 32 bytes from the platform's CSPRNG — §14's "≥256-bit secret in the URL
 * fragment" — encoded base64url so it survives a fragment, a chat message and a
 * copy-paste without escaping. `crypto.getRandomValues` and not `Math.random`,
 * which is not a question of taste: the invite secret is the only thing standing
 * between a link and a circle's roster.
 */
export function inviteSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}

function base64url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

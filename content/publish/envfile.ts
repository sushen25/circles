/**
 * Rewrites one `KEY=value` line in the local .env, keeping everything else.
 * Used when a platform hands back a new token (TikTok's rotated refresh
 * token, Meta's refreshed long-lived tokens). Returns false when there is no
 * .env (CI), so the caller can say what to update by hand instead.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function setEnvLine(key: string, value: string, path = '.env'): boolean {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  const line = new RegExp(`^${key}=.*$`, 'm');
  writeFileSync(path, line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.replace(/\n?$/, '\n')}${key}=${value}\n`);
  return true;
}

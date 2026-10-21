/**
 * The one way a platform module talks to the network. It exists so that no
 * token ever reaches a log line: a URL that carries `access_token=…` or
 * `key=…` is redacted before it is put in an error, and so is a response
 * body that echoes one back.
 *
 * One retry, on a 5xx or a network error, after a short pause; a 4xx is
 * returned at once because repeating it changes nothing.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  constructor(status: number, url: string, body: string) {
    super(`${status} ${redact(url)}: ${redact(body).slice(0, 300)}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = redact(url);
    this.body = redact(body);
  }
}

/** Blanks every value that looks like a credential, in a URL or a JSON body. */
export function redact(s: string): string {
  return s
    .replace(/((?:access_token|refresh_token|client_secret|key|token|secret|password|authorization)=)[^&\s"']+/gi, '$1…')
    .replace(/("(?:access_token|refresh_token|client_secret|token|secret|password)"\s*:\s*")[^"]+/gi, '$1…')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1…');
}

/** Swapped out by the tests so the retry pause does not wait. */
export const clock = { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

/** `fetch` JSON with one retry on a 5xx or a thrown fetch; the error never carries a secret. */
export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, init);
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : {}) as T;
      if (res.status < 500 || attempt === 1) throw new HttpError(res.status, url, text);
      last = new HttpError(res.status, url, text);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      last = new Error(`${redact(url)}: ${redact((e as Error).message)}`);
    }
    await clock.sleep(1_500);
  }
  throw last;
}

/** Build a URL with query parameters; the module passes the token here and never into a string. */
export function withQuery(base: string, params: Record<string, string | number | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

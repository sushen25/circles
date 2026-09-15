import { Platform } from 'react-native';

/**
 * Cloudflare Turnstile, web only (architecture §14: "Turnstile on web joins").
 *
 * One file rather than the `turnstile/` folder the ticket sketched: there is a
 * single adapter with one exported function, and a directory for that is a
 * layer to step through rather than a boundary to enforce.
 *
 * **Native has no widget and needs none.** Installing an app is the friction
 * Turnstile is standing in for on the web. The server agrees by reading the
 * `x-circles-platform` header (`client.ts`), so nothing here has to pretend.
 *
 * **What this is worth is bounded, and saying so is part of the design.**
 * `_shared/turnstile.ts` takes the platform from a header the client sets, so a
 * caller can claim to be native and skip the check entirely. That is known and
 * accepted: the invite secret, the member cap and the per-IP rate limit are
 * what actually hold. Turnstile raises the cost of scripted joins from a
 * one-line script to a real browser, and no more than that.
 */

/**
 * Cloudflare's own script. Not bundled: it is a challenge the vendor updates on
 * their own cadence, and a pinned copy would be one whose failure mode is
 * "silently stops challenging" — the worst direction for this.
 */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Longer than a challenge should ever take, short enough that a join does not
 * appear to hang. A join is a person waiting on a screen, and Cloudflare having
 * a bad day must not read as the product being broken.
 */
const TIMEOUT_MS = 20_000;

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback': () => void;
      'timeout-callback'?: () => void;
      appearance?: string;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

function api(): TurnstileApi | undefined {
  return (globalThis as unknown as { turnstile?: TurnstileApi }).turnstile;
}

let loading: Promise<void> | undefined;

function loadScript(): Promise<void> {
  if (api() !== undefined) return Promise.resolve();
  // One load for the life of the page, however many joins happen on it.
  if (loading !== undefined) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const script = globalThis.document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      resolve();
    });
    script.addEventListener('error', () => {
      // Let the next attempt try again: this is usually a network blip or a
      // blocker, and both can change between one join and the next.
      loading = undefined;
      reject(new Error('turnstile: script did not load'));
    });
    globalThis.document.head.append(script);
  });

  return loading;
}

/**
 * A token for one join.
 *
 * **`undefined` is a real answer, not a failure.** It means "this caller has no
 * challenge to offer" — native, or a web build with no site key, which is every
 * local run. The server decides what that is worth; the client's job is to be
 * honest about it rather than to invent a token or to refuse to continue. A
 * client that blocked the join here would make Turnstile a single point of
 * failure for joining a circle, which is exactly what §14 says it is not.
 *
 * A token is single-use and expires in minutes, so this is called per join
 * rather than cached.
 */
export async function getTurnstileToken(): Promise<string | undefined> {
  if (Platform.OS !== 'web') return undefined;

  const sitekey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  if (sitekey === undefined || sitekey === '') return undefined;
  if (globalThis.document === undefined) return undefined;

  try {
    await loadScript();
  } catch {
    return undefined;
  }

  const turnstile = api();
  if (turnstile === undefined) return undefined;

  // Off-screen rather than `display: none`: a hidden container can stop the
  // widget from running at all, and an invisible challenge still needs a box
  // the browser considers real.
  const container = globalThis.document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  globalThis.document.body.append(container);

  let widgetId: string | undefined;
  const cleanUp = (): void => {
    try {
      if (widgetId !== undefined) turnstile.remove(widgetId);
    } catch {
      // The widget may already be gone; removing it twice must not throw into
      // the join.
    }
    container.remove();
  };

  return await new Promise<string | undefined>((resolve) => {
    let settled = false;
    const finish = (token: string | undefined): void => {
      if (settled) return;
      settled = true;
      cleanUp();
      resolve(token);
    };

    const timer = setTimeout(() => {
      finish(undefined);
    }, TIMEOUT_MS);

    const done = (token: string | undefined): void => {
      clearTimeout(timer);
      finish(token);
    };

    try {
      widgetId = turnstile.render(container, {
        sitekey,
        appearance: 'interaction-only',
        callback: (token: string) => {
          done(token);
        },
        'error-callback': () => {
          done(undefined);
        },
        'timeout-callback': () => {
          done(undefined);
        },
      });
    } catch {
      done(undefined);
    }
  });
}

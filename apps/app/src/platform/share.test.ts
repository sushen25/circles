import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText, shareMessage } from './share';

/**
 * The browser half of sharing (S1-22). Tests run through react-native-web, so
 * `Platform.OS` is `web` and these are the paths a phone's browser takes.
 */

const nav = navigator as unknown as Record<string, unknown>;

function stub(name: string, value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

afterEach(() => {
  for (const name of ['share', 'canShare', 'clipboard']) stub(name, undefined);
  vi.restoreAllMocks();
});

describe('shareMessage', () => {
  it('opens the system sheet where there is one (iOS Safari, Android Chrome)', async () => {
    const share = vi.fn(async () => undefined);
    stub('share', share);
    expect(await shareMessage('hello')).toBe('sheet');
    expect(share).toHaveBeenCalledWith({ text: 'hello' });
  });

  it('treats closing the sheet as an answer, not a failure', async () => {
    stub(
      'share',
      vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))),
    );
    expect(await shareMessage('hello')).toBe('dismissed');
  });

  it('copies instead where there is no sheet (the in-app browsers)', async () => {
    const writeText = vi.fn(async () => undefined);
    stub('clipboard', { writeText });
    expect(nav.share).toBeUndefined();
    expect(await shareMessage('hello')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('hello');
  });
});

describe('copyText', () => {
  it('falls back to selecting a textarea when the Clipboard API refuses', async () => {
    stub('clipboard', { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });

    expect(await copyText('hello')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    // And leaves nothing behind in the page.
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('says so when nothing worked', async () => {
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    expect(await copyText('hello')).toBe(false);
  });
});

import { Platform, Share } from 'react-native';

/**
 * Handing a message to the group chat (spec §5.1 step 5, §5.8).
 *
 * **The system share sheet where there is one, and a copy where there is
 * not.** iOS Safari and Android Chrome have `navigator.share`; the in-app
 * browsers of WhatsApp and Messenger mostly do not, and neither does a desktop
 * browser without it switched on. There, the message is copied instead and the
 * screen says so — never a button that silently does nothing.
 *
 * Copying on the web tries the async Clipboard API first, then the old
 * select-a-textarea route, which is the one that still works inside in-app
 * browsers that refuse the Clipboard API outside a secure, focused document.
 * Natively there is no clipboard module in this app (no dependency is added
 * for it), so Copy opens the share sheet, which has its own Copy.
 *
 * What is shared is whatever the caller built; nothing here logs it, and the
 * results carry no part of it.
 */
export type ShareResult = 'sheet' | 'copied' | 'dismissed' | 'failed';

type WebNavigator = {
  share?: (data: { text?: string }) => Promise<void>;
  canShare?: (data: { text?: string }) => boolean;
  clipboard?: { writeText?: (text: string) => Promise<void> };
};

function webNavigator(): WebNavigator | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as unknown as WebNavigator);
}

/** Whether a system share sheet exists here. */
export function canOpenShareSheet(): boolean {
  if (Platform.OS !== 'web') return true;
  const nav = webNavigator();
  if (typeof nav?.share !== 'function') return false;
  try {
    return nav.canShare === undefined || nav.canShare({ text: 'x' });
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet with `text`, or copies it where there is no sheet.
 *
 * `sheet` means the sheet opened and the person did not back out of it (the
 * web cannot say more than that); `dismissed` that they closed it.
 */
export async function shareMessage(text: string): Promise<ShareResult> {
  if (Platform.OS !== 'web') {
    try {
      const result = await Share.share({ message: text });
      return result.action === Share.dismissedAction ? 'dismissed' : 'sheet';
    } catch {
      return 'failed';
    }
  }

  if (!canOpenShareSheet()) return (await copyText(text)) ? 'copied' : 'failed';

  try {
    await webNavigator()!.share!({ text });
    return 'sheet';
  } catch (error) {
    // `AbortError` is the person closing the sheet, which is an answer rather
    // than a failure; anything else falls back to copying.
    if ((error as { name?: string })?.name === 'AbortError') return 'dismissed';
    return (await copyText(text)) ? 'copied' : 'failed';
  }
}

/** Copies `text`. True when it worked. */
export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS !== 'web') {
    const shared = await shareMessage(text);
    return shared === 'sheet';
  }

  const clipboard = webNavigator()?.clipboard;
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Refused (an in-app browser, an unfocused frame): try the old way.
    }
  }
  return copyWithTextarea(text);
}

/**
 * The fallback that in-app browsers still honour: a textarea, selected, and
 * `execCommand('copy')`. Off screen and read-only so that nothing jumps and no
 * keyboard opens.
 */
function copyWithTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

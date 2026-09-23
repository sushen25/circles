import { Platform } from 'react-native';

/**
 * Handing a file to the person (spec §5.7: "web participants get an `.ics`
 * download").
 *
 * **On the web, an `<a download>` over a blob.** The file has already been
 * fetched with the member's bearer, so there is no URL a browser could simply
 * open; a blob URL is the file itself, and the `download` attribute names it.
 * Mobile Safari offers it to Calendar and Chrome on Android saves it, which is
 * what the ticket asks of each (S1-28).
 *
 * **Natively there is no path yet.** Native add-to-calendar is Slice 3's, and
 * this app carries no file-system module; `unsupported` says so rather than a
 * button that silently does nothing.
 *
 * What is saved is whatever the caller built; nothing here logs it.
 */
export type SaveResult = 'saved' | 'unsupported' | 'failed';

export function saveFile(contents: string, filename: string, type: string): SaveResult {
  if (Platform.OS !== 'web') return 'unsupported';
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return 'failed';
  }

  let url: string | undefined;
  try {
    url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return 'saved';
  } catch {
    return 'failed';
  } finally {
    // Later, not now: Safari reads the blob after the click returns, and a URL
    // revoked in the same tick is a download of nothing.
    const done = url;
    if (done !== undefined) setTimeout(() => URL.revokeObjectURL(done), 60_000);
  }
}

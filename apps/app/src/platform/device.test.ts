import { describe, expect, it } from 'vitest';

import { deviceOf } from './device';

const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MESSENGER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/458.0.0.43.109;FBBV/612345678;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_GB;FBOP/5]';
const CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240105.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

describe('deviceOf', () => {
  it('knows iPhone Safari, Android Chrome and a desktop', () => {
    expect(deviceOf(SAFARI)).toEqual({ kind: 'ios', inApp: false });
    expect(deviceOf(CHROME)).toEqual({ kind: 'android', inApp: false });
    expect(deviceOf(DESKTOP)).toEqual({ kind: 'other', inApp: false });
  });

  it('knows an iPad that asks for the desktop site', () => {
    expect(deviceOf(DESKTOP, 5)).toEqual({ kind: 'ios', inApp: false });
  });

  it('knows the Messenger and WhatsApp (Android WebView) in-app browsers', () => {
    expect(deviceOf(MESSENGER)).toEqual({ kind: 'ios', inApp: true });
    expect(deviceOf(WEBVIEW)).toEqual({ kind: 'android', inApp: true });
  });
});

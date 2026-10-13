import { Platform } from 'react-native';

/**
 * What kind of phone this is, for words only: the add-to-calendar row says what
 * its tap does on *this* device, and what to do next (SUS-154). Nothing here
 * changes what the app does, and nothing is sent anywhere.
 *
 * `ios` includes an iPad that asks for the desktop site (it reports a Mac with a
 * touch screen). `inApp` is a WhatsApp, Messenger, Facebook or Instagram
 * browser, or any Android WebView: places where a saved file may land nowhere
 * the person can reach, so the words offer the real browser.
 */
export type DeviceKind = 'ios' | 'android' | 'other';
export type Device = { kind: DeviceKind; inApp: boolean };

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|; wv\)/i;

export function deviceOf(ua: string, touchPoints = 0): Device {
  const inApp = IN_APP.test(ua);
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) {
    return { kind: 'ios', inApp };
  }
  if (/Android/.test(ua)) return { kind: 'android', inApp };
  return { kind: 'other', inApp };
}

export function currentDevice(): Device {
  if (Platform.OS === 'ios') return { kind: 'ios', inApp: false };
  if (Platform.OS === 'android') return { kind: 'android', inApp: false };
  if (typeof navigator === 'undefined') return { kind: 'other', inApp: false };
  return deviceOf(navigator.userAgent, navigator.maxTouchPoints);
}

import { brand } from '@circles/config';
import type { EventPayload } from '@circles/contracts';
import { Linking, Platform } from 'react-native';

import { t } from '../../copy';

/**
 * "Something off? Tell me" (SUS-170): a mail to the founder, from inside the
 * product. Email is the channel until a cohort says it is not enough.
 *
 * **The subject names the screen and the platform and nothing else**, and the
 * body is empty: the person writes what they want. This function takes no plan
 * code, circle id or name, so none can reach the message (spec §8.2).
 */
export type FeedbackScreen = EventPayload<'feedback_opened'>['screen'];

const SCREEN_WORD = {
  sent: 'screen_sent',
  confirmed: 'screen_confirmed',
  circle_home: 'screen_circle_home',
} as const satisfies Record<FeedbackScreen, string>;

export type FeedbackPlatform = 'web' | 'ios' | 'android';

export function feedbackPlatform(): FeedbackPlatform {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
}

export function feedbackSubject(
  screen: FeedbackScreen,
  platform: FeedbackPlatform = feedbackPlatform(),
): string {
  return t('feedback', 'subject', { screen: t('feedback', SCREEN_WORD[screen]), platform });
}

export function feedbackMailto(
  screen: FeedbackScreen,
  platform: FeedbackPlatform = feedbackPlatform(),
): string {
  // No `body` parameter: it stays empty.
  return `mailto:${brand.supportEmail}?subject=${encodeURIComponent(feedbackSubject(screen, platform))}`;
}

/**
 * On the web, navigating to a `mailto:` hands it to the mail client without
 * opening a blank tab, which `window.open` (what `Linking` does there) can.
 */
export function openFeedbackMail(url: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.location.assign(url);
    return;
  }
  void Linking.openURL(url).catch(() => undefined);
}

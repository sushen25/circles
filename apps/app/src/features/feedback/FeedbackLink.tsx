import { brand } from '@circles/config';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { track } from '../../analytics/track';
import { Small, Tertiary } from '../../components';
import { t } from '../../copy';
import { copyText } from '../../platform/share';
import { feedbackMailto, openFeedbackMail, type FeedbackScreen } from './feedback';

/**
 * The one quiet way to reach the founder (SUS-170): a Tertiary pill under the
 * primary actions of Sent, Confirmed and circle home. Not on join or the
 * availability editor (spec §5.11: nothing between the link and the answer).
 * Counts the tap by screen; the event carries no circle, plan or words.
 *
 * Nobody can tell whether a mail app opened (a desktop browser with no mail
 * handler, WhatsApp's or Messenger's in-app browser, a phone with Mail
 * removed), so the first tap also says the address in plain text, selectable,
 * with a way to copy it on the web. Nothing shows before the tap, which keeps the footer
 * as short as it was. The line sits in a polite live region mounted from the
 * start, so a screen reader hears it arrive; the region has no height empty.
 */
export function FeedbackLink({ screen }: { screen: FeedbackScreen }) {
  const [tapped, setTapped] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <View style={styles.wrap}>
      <Tertiary
        label={t('feedback', 'link')}
        onPress={() => {
          track('feedback_opened', { screen });
          setTapped(true);
          openFeedbackMail(feedbackMailto(screen));
        }}
      />
      <View style={styles.fallback} accessibilityLiveRegion="polite" aria-live="polite">
        {tapped ? (
          <>
            <Small selectable style={styles.line}>
              {t('feedback', 'no_mail_app')}
            </Small>
            {/* Natively `copyText` opens the share sheet and cannot say the clipboard
                changed, so the pill would claim a copy it did not make; the text
                is selectable there instead. */}
            {Platform.OS !== 'web' ? null : (
              <Tertiary
                label={copied ? t('feedback', 'address_copied') : t('feedback', 'copy_address')}
                onPress={() => {
                  void copyText(brand.supportEmail).then((done) => setCopied(done));
                }}
              />
            )}
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  fallback: { alignItems: 'center', gap: 2 },
  line: { textAlign: 'center' },
});

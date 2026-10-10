import { track } from '../../analytics/track';
import { Tertiary } from '../../components';
import { t } from '../../copy';
import { feedbackMailto, openFeedbackMail, type FeedbackScreen } from './feedback';

/**
 * The one quiet way to reach the founder (SUS-170): a Tertiary pill under the
 * primary actions of Sent, Confirmed and circle home. Not on join or the
 * availability editor (spec §5.11: nothing between the link and the answer).
 * Counts the tap by screen; the event carries no circle, plan or words.
 */
export function FeedbackLink({ screen }: { screen: FeedbackScreen }) {
  return (
    <Tertiary
      label={t('feedback', 'link')}
      onPress={() => {
        track('feedback_opened', { screen });
        openFeedbackMail(feedbackMailto(screen));
      }}
    />
  );
}

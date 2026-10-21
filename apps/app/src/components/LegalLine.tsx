import { t } from '../copy';
import { InlineLink, Small } from './Text';

/**
 * The small line that sits where people are first asked for something: the
 * guest join, the name step and the email offer on Sent (S4-05). It says who the
 * product is for and links the two pages, in the same underlined links as the
 * small print on sign-in, and never asks for a tick: using the product after
 * reading it is the agreement the terms describe.
 */
export function LegalLine({
  onTerms,
  onPrivacy,
}: {
  onTerms?: (() => void) | undefined;
  onPrivacy?: (() => void) | undefined;
}) {
  return (
    <Small>
      {t('legal', 'for_people_18_and_over')}{' '}
      <InlineLink onPress={onTerms}>{t('legal', 'terms')}</InlineLink> {t('legal', 'and')}{' '}
      <InlineLink onPress={onPrivacy}>{t('legal', 'privacy')}</InlineLink>.
    </Small>
  );
}

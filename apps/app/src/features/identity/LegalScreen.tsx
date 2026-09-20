import { Body, BodyText, DisplayL, Screen, Small, Title, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * `/terms` and `/privacy` — the basics Welcome's small print links to
 * (spec §5.1 step 1: "no ads, no selling data, 18+").
 *
 * Static copy, readable by anyone with no session, and no artboard of its own.
 * These are the plain-language commitments of spec §13, not a lawyer's text;
 * the formal documents for the external cohort replace the words, not the
 * routes.
 */
export type LegalKind = 'terms' | 'privacy';

const SECTIONS: Record<LegalKind, readonly (readonly [string, string])[]> = {
  terms: [
    [t('legal', 'terms_who_heading'), t('legal', 'terms_who_body')],
    [t('legal', 'terms_what_heading'), t('legal', 'terms_what_body')],
    [t('legal', 'terms_kind_heading'), t('legal', 'terms_kind_body')],
    [t('legal', 'terms_beta_heading'), t('legal', 'terms_beta_body')],
  ],
  privacy: [
    [t('legal', 'privacy_keep_heading'), t('legal', 'privacy_keep_body')],
    [t('legal', 'privacy_never_heading'), t('legal', 'privacy_never_body')],
    [t('legal', 'privacy_calendar_heading'), t('legal', 'privacy_calendar_body')],
    [t('legal', 'privacy_leave_heading'), t('legal', 'privacy_leave_body')],
  ],
};

export function LegalScreen({ kind, onBack }: { kind: LegalKind; onBack?: () => void }) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>
          {kind === 'terms' ? t('legal', 'terms_title') : t('legal', 'privacy_title')}
        </DisplayL>
        {SECTIONS[kind].map(([heading, body]) => (
          <Stack key={heading}>
            <Title>{heading}</Title>
            <BodyText>{body}</BodyText>
          </Stack>
        ))}
        <Small>{t('legal', 'questions')}</Small>
      </Body>
    </Screen>
  );
}

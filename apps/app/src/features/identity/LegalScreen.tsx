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

/** A heading and its paragraphs, each its own copy key so a test can pin one. */
type Section = readonly [heading: string, ...paragraphs: string[]];

const SECTIONS: Record<LegalKind, readonly Section[]> = {
  terms: [
    [t('legal', 'terms_operator_heading'), t('legal', 'terms_operator_body')],
    [t('legal', 'terms_who_heading'), t('legal', 'terms_who_body')],
    [t('legal', 'terms_what_heading'), t('legal', 'terms_what_body')],
    [t('legal', 'terms_promise_heading'), t('legal', 'terms_promise_body')],
    [t('legal', 'terms_kind_heading'), t('legal', 'terms_kind_body')],
    [t('legal', 'terms_leave_heading'), t('legal', 'terms_leave_body')],
    [t('legal', 'terms_beta_heading'), t('legal', 'terms_beta_body')],
  ],
  privacy: [
    [t('legal', 'privacy_operator_heading'), t('legal', 'privacy_operator_body')],
    [t('legal', 'privacy_age_heading'), t('legal', 'privacy_age_body')],
    [
      t('legal', 'privacy_keep_heading'),
      t('legal', 'privacy_keep_given'),
      t('legal', 'privacy_keep_circle'),
      t('legal', 'privacy_keep_systems'),
      t('legal', 'privacy_keep_host'),
    ],
    [t('legal', 'privacy_never_heading'), t('legal', 'privacy_never_body')],
    [
      t('legal', 'privacy_others_heading'),
      t('legal', 'privacy_others_body'),
      t('legal', 'privacy_others_supabase'),
      t('legal', 'privacy_others_resend'),
      t('legal', 'privacy_others_cloudflare'),
      t('legal', 'privacy_others_expo'),
      t('legal', 'privacy_others_forwarder'),
    ],
    [
      t('legal', 'privacy_email_heading'),
      t('legal', 'privacy_email_body'),
      t('legal', 'privacy_email_guests'),
    ],
    [t('legal', 'privacy_calendar_heading'), t('legal', 'privacy_calendar_body')],
    [
      t('legal', 'privacy_retain_heading'),
      t('legal', 'privacy_retain_times'),
      t('legal', 'privacy_retain_email'),
      t('legal', 'privacy_retain_other'),
      t('legal', 'privacy_retain_account'),
      t('legal', 'privacy_retain_open'),
    ],
    [
      t('legal', 'privacy_rights_heading'),
      t('legal', 'privacy_rights_access'),
      t('legal', 'privacy_rights_correct'),
      t('legal', 'privacy_rights_delete'),
      t('legal', 'privacy_rights_complain'),
    ],
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
        <Small>{t('legal', 'version')}</Small>
        {SECTIONS[kind].map(([heading, ...paragraphs]) => (
          <Stack key={heading}>
            <Title>{heading}</Title>
            {paragraphs.map((text) => (
              <BodyText key={text}>{text}</BodyText>
            ))}
          </Stack>
        ))}
        <Small>{t('legal', 'questions')}</Small>
      </Body>
    </Screen>
  );
}

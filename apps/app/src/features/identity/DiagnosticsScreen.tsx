import { Body, Card, DisplayL, Label, Screen, Small, Title, TopBar } from '../../components';
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Diagnostics — scaffolded from `docs/design/Diagnostics.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type DiagnosticsProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function DiagnosticsScreen({ onBack }: DiagnosticsProps) {
  return (
    <Screen>
      <TopBar
        title={t('diagnostics', 'founder_tools')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('diagnostics', 'beta_diagnostics')}</DisplayL>
          <Small>{t('diagnostics', 'allowlisted_accounts_only_aggregates_never_names_or')}</Small>
        </Stack>
        <Card>
          <Row>
            <Small>{t('diagnostics', 'active_circles')}</Small>
          </Row>
          <Divider />
          <Row>
            <Small>{t('diagnostics', 'plans_confirmed_created')}</Small>
          </Row>
          <Divider />
          <Row>
            <Small>{t('diagnostics', 'reported_happened')}</Small>
            <Title>{t('diagnostics', '3_of_4')}</Title>
          </Row>
          <Divider />
          <Row>
            <Small>{t('diagnostics', 'median_link_reply')}</Small>
            <Title>{t('diagnostics', '1_m_40_s')}</Title>
          </Row>
          <Divider />
          <Row>
            <Small>{t('diagnostics', 'reattached_members')}</Small>
          </Row>
        </Card>
        <Card>
          <Label>{t('diagnostics', 'recent_jobs')}</Label>
          <Row>
            <Small>{t('diagnostics', 'deadline_reminder_plan_8k2v')}</Small>
            <Small>{t('diagnostics', 'sent')}</Small>
          </Row>
          <Row>
            <Small>{t('diagnostics', 'outcome_prompt_plan_8k2v')}</Small>
            <Small>{t('diagnostics', 'queued')}</Small>
          </Row>
          <Row>
            <Small>{t('diagnostics', 'cadence_prompt_circle_s1')}</Small>
            <Small>{t('diagnostics', 'skipped_active_plan')}</Small>
          </Row>
        </Card>
      </Body>
    </Screen>
  );
}

import {
  FUNNEL_SOURCES,
  funnelOf,
  type FounderAnalytics,
  type FunnelSourceFilter,
} from '@circles/contracts';
import { useState } from 'react';

import { Card, Chip, Chips, Label, Small, Title } from '../../components';
import { Divider, Stack } from '../../components/layout';
import { copy, t } from '../../copy';
import { percent } from './figures';
import { Line } from './Line';

/**
 * The funnel (spec §11.2), stage by stage with counts and the share of the step
 * before. Counts only: the quiet ask's stage is the two unattributed events'
 * totals and says what is not recorded (ADR 0041).
 */
export function FunnelSection({ data }: { data: FounderAnalytics }) {
  const [by, setBy] = useState<FunnelSourceFilter | undefined>();
  const stages = funnelOf(data, by);
  return (
    <Stack gap={10}>
      <Label>{t('founderAnalytics', 'funnel')}</Label>
      <Small>{t('founderAnalytics', 'funnel_detail')}</Small>
      <Small>{t('founderAnalytics', 'funnel_source_group')}</Small>
      <Chips>
        <Chip
          label={t('founderAnalytics', 'funnel_source_all')}
          selected={by === undefined}
          onPress={() => setBy(undefined)}
        />
        {FUNNEL_SOURCES.map((source) => (
          <Chip
            key={source}
            label={words(`funnel_source_${source}`)}
            selected={by === source}
            onPress={() => setBy(source)}
          />
        ))}
      </Chips>
      {by === undefined ? null : <Small>{t('founderAnalytics', 'funnel_source_detail')}</Small>}
      <Card gap={14}>
        {stages.map((stage, index) => (
          <Stack key={stage.id} gap={8}>
            {index === 0 ? null : <Divider />}
            <Title>{words(`stage_${stage.id}`)}</Title>
            {stage.steps.map((step) => (
              <Line
                key={step.id}
                label={words(`step_${step.id}`)}
                figure={
                  step.share === null
                    ? String(step.count)
                    : `${step.count} · ${t('founderAnalytics', 'share_of_previous', { label: percent(step.share) })}`
                }
              />
            ))}
            {stage.hasMissing ? <Small>{words(`stage_${stage.id}_missing`)}</Small> : null}
          </Stack>
        ))}
      </Card>
    </Stack>
  );
}

/**
 * The words for a stage or step the contracts declare, by id. A test holds every
 * declared id to a key, so the id on screen is the sign that one was missed.
 */
function words(key: string): string {
  return (copy.founderAnalytics as Record<string, string>)[key] ?? key;
}

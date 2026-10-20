import {
  STALL_STATES,
  stalledOf,
  stalledTotal,
  type FounderAnalytics,
  type StallCohortFilter,
} from '@circles/contracts';
import { useState } from 'react';

import { BodyText, Card, Chip, Chips, Label, Small, Title } from '../../components';
import { Divider, Stack } from '../../components/layout';
import { copy, t } from '../../copy';
import { ageOf, dayOf } from './figures';

const COHORTS = ['all', 'founder', 'external'] as const;

/**
 * Stalled first plans (SUS-240): the circles whose first plan has stopped, in
 * its three states, by the week the circle began and where the organiser heard
 * of us. Counts and ages, from the product's own rows; nothing names a circle,
 * a plan or a person.
 */
export function StalledSection({ data }: { data: FounderAnalytics }) {
  const [cohort, setCohort] = useState<StallCohortFilter>('all');
  const weeks = stalledOf(data, cohort);
  return (
    <Stack gap={10}>
      <Label>{t('founderAnalytics', 'stalled')}</Label>
      <Small>{t('founderAnalytics', 'stalled_detail')}</Small>
      <Chips>
        {COHORTS.map((value) => (
          <Chip
            key={value}
            label={words(`stalled_cohort_${value}`)}
            selected={cohort === value}
            onPress={() => setCohort(value)}
          />
        ))}
      </Chips>
      {stalledTotal(data, cohort) === 0 ? (
        <Small>{t('founderAnalytics', 'stalled_empty')}</Small>
      ) : (
        <Card gap={14}>
          {weeks.map((week, index) => (
            <Stack key={week.week} gap={10}>
              {index === 0 ? null : <Divider />}
              <Label>{t('founderAnalytics', 'stalled_week', { date: dayOf(week.week) })}</Label>
              {week.sources.map((row) => (
                <Stack key={row.source} gap={6}>
                  <Title>{words(`funnel_source_${row.source}`)}</Title>
                  {STALL_STATES.map((state) => {
                    const figures = row.states[state];
                    return (
                      <Stack key={state} gap={0}>
                        <Small>{words(`stalled_state_${state}`)}</Small>
                        <BodyText>
                          {figures.circles === 0
                            ? t('founderAnalytics', 'stalled_none')
                            : t('founderAnalytics', 'stalled_figure', {
                                count: figures.circles,
                                oldest: ageOf(figures.oldestHours),
                                median: ageOf(figures.medianHours),
                              })}
                        </BodyText>
                      </Stack>
                    );
                  })}
                </Stack>
              ))}
            </Stack>
          ))}
        </Card>
      )}
      <Small>{t('founderAnalytics', 'stalled_caveat')}</Small>
    </Stack>
  );
}

function words(key: string): string {
  return (copy.founderAnalytics as Record<string, string>)[key] ?? key;
}

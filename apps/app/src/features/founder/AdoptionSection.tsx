import { adoptionOf, ratesOf, type FounderAnalytics } from '@circles/contracts';

import { Card, Label, Small, Title } from '../../components';
import { Divider, Stack } from '../../components/layout';
import { copy, t } from '../../copy';
import { dayOf, percent } from './figures';
import { Line } from './Line';

/**
 * Feature adoption: every event in the catalogue with its count each week, and
 * for every boolean or enum field it carried, the split by value. Generic on
 * purpose: a new event or field is a row the function returns, and appears here
 * with no change to this file. Beside it, the named rates declared in
 * `@circles/contracts`.
 *
 * Events with nothing in the period are listed once, in one line, so the list
 * is still every event and a quiet one is not a blank card.
 */
export function AdoptionSection({ data }: { data: FounderAnalytics }) {
  const events = adoptionOf(data);
  const sent = events.filter((event) => event.total > 0);
  const quiet = events.filter((event) => event.total === 0);

  return (
    <Stack gap={10}>
      <Label>{t('founderAnalytics', 'adoption')}</Label>
      <Small>{t('founderAnalytics', 'adoption_detail')}</Small>
      <Rates data={data} />
      {sent.map((event) => (
        <Card key={event.event} gap={8}>
          <Title>{event.event}</Title>
          <Small>{t('founderAnalytics', 'adoption_total', { count: event.total })}</Small>
          {event.weeks.map((week) => (
            <Line
              key={week.week}
              label={t('founderAnalytics', 'adoption_week', { date: dayOf(week.week) })}
              figure={String(week.count)}
            />
          ))}
          {event.fields.map((field) => (
            <Stack key={field.field} gap={4}>
              <Divider />
              {field.values.map((value) => (
                <Line
                  key={value.value}
                  label={`${field.field} · ${value.value}`}
                  figure={String(value.count)}
                />
              ))}
            </Stack>
          ))}
        </Card>
      ))}
      {quiet.length === 0 ? null : (
        <Card gap={6}>
          <Title>{t('founderAnalytics', 'adoption_quiet')}</Title>
          <Small>{quiet.map((event) => event.event).join(' · ')}</Small>
        </Card>
      )}
    </Stack>
  );
}

function Rates({ data }: { data: FounderAnalytics }) {
  const rates = ratesOf(data);
  return (
    <Card gap={8}>
      <Title>{t('founderAnalytics', 'rates')}</Title>
      {rates.map((rate) => {
        const label =
          (copy.founderAnalytics as Record<string, string>)[`rate_${rate.id}`] ?? rate.id;
        return (
          <Stack key={rate.id} gap={2}>
            <Small>{label}</Small>
            <Small>
              {rate.value === null
                ? t('founderAnalytics', 'rate_none')
                : t('founderAnalytics', 'rate_of', {
                    label: percent(rate.value),
                    count: rate.numerator,
                    total: rate.denominator,
                  })}
            </Small>
          </Stack>
        );
      })}
    </Card>
  );
}

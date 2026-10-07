import type { NorthStarMonth } from '@circles/contracts';

import { BodyText, Card, DateText, Label, Small, Title } from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import { monthOf, perCircle } from './figures';

/**
 * The north star (spec §11.1): reported-happened meetups per activated circle,
 * month by month, with the corroborated count beside it and never folded in.
 * Numbers, not a chart: a chart has not earned its place at six months.
 */
export function NorthStarSection({ months }: { months: readonly NorthStarMonth[] }) {
  // Newest first: the month being lived in is the one to read.
  const rows = [...months].reverse();
  const [latest, ...earlier] = rows;

  return (
    <Stack gap={10}>
      <Label>{t('founderAnalytics', 'north_star')}</Label>
      <Small>{t('founderAnalytics', 'north_star_detail')}</Small>
      {latest === undefined ? (
        <BodyText>{t('founderAnalytics', 'north_star_empty')}</BodyText>
      ) : (
        <Card gap={8}>
          <Stack gap={2}>
            <Title>{monthOf(latest.month)}</Title>
            <DateText>
              {perCircle(latest.happened_reported, latest.activated_circles) ??
                t('founderAnalytics', 'none_yet')}
            </DateText>
            <Small>{line(latest)}</Small>
          </Stack>
          {earlier.length === 0 ? null : <Divider />}
          {earlier.map((month) => (
            <Stack key={month.month} gap={2}>
              <Title>{monthOf(month.month)}</Title>
              <Small>
                {perCircle(month.happened_reported, month.activated_circles) ??
                  t('founderAnalytics', 'north_star_no_circles')}
                {' · '}
                {line(month)}
              </Small>
            </Stack>
          ))}
        </Card>
      )}
    </Stack>
  );
}

function line(month: NorthStarMonth): string {
  return t('founderAnalytics', 'north_star_line', {
    count: month.happened_reported,
    total: month.happened_corroborated,
    from: month.activated_circles,
  });
}

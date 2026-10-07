import {
  FOUNDER_PERIODS,
  isEmpty,
  type FounderAnalytics,
  type FounderPeriod,
} from '@circles/contracts';

import {
  Body,
  BodyText,
  Button,
  Chip,
  Chips,
  DisplayL,
  Loading,
  Notice,
  Screen,
  Small,
  TopBar,
  useLoadingHold,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ScreenState } from '../state';
import { NotFoundScreen } from '../system/NotFoundScreen';
import { AdoptionSection } from './AdoptionSection';
import { dayOf } from './figures';
import { FunnelSection } from './FunnelSection';
import { GatesSection } from './GatesSection';
import { NorthStarSection } from './NorthStarSection';

/**
 * Founder analytics — `docs/design/FounderAnalytics.dc.html` (SUS-166): the
 * north star, the decision gates, the funnel and every feature's adoption, for
 * a chosen period. Aggregates and nothing else; it names no person, circle or
 * plan, and it records no analytics event of its own.
 *
 * States: `loading` is shaped like the screen; `empty` is a database with
 * nothing in it; `error` and `offline` carry a reference to read out;
 * `denied` is the not-found screen and says nothing else, so a route that is
 * not yours does not say it is there. `partial` (some gates "Not measured") is
 * the ordinary default. `expired` has no meaning here.
 */
export type AnalyticsScreenProps = {
  state?: ScreenState | undefined;
  data?: FounderAnalytics | undefined;
  period?: FounderPeriod | undefined;
  /** What to read out when a load fails. */
  reference?: string | undefined;
  onPeriod?: ((period: FounderPeriod) => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

const PERIOD_LABEL = {
  7: 'period_7',
  30: 'period_30',
  90: 'period_90',
} as const;

export function AnalyticsScreen({
  state = 'default',
  data,
  period = 30,
  reference,
  onPeriod,
  onRetry,
  onBack,
}: AnalyticsScreenProps) {
  const loading = useLoadingHold(state === 'loading');
  const title = t('founderAnalytics', 'top_title');

  if (state === 'denied') return <NotFoundScreen />;
  if (loading) {
    return (
      <Loading
        message={t('founderAnalytics', 'loading')}
        shape="cards"
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar title={title} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayL>
            {state === 'offline'
              ? t('founderAnalytics', 'offline_title')
              : t('founderAnalytics', 'error_title')}
          </DisplayL>
          {reference === undefined || state === 'offline' ? null : (
            <Notice kind="warn">{t('founderAnalytics', 'reference', { reference })}</Notice>
          )}
          <Button label={t('founderAnalytics', 'try_again')} onPress={onRetry} />
        </Body>
      </Screen>
    );
  }

  const empty = data === undefined || isEmpty(data);
  return (
    <Screen>
      <TopBar title={title} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack gap={4}>
          <DisplayL>{t('founderAnalytics', 'heading')}</DisplayL>
          <Small>{t('founderAnalytics', 'intro')}</Small>
        </Stack>
        <Chips>
          {FOUNDER_PERIODS.map((days) => (
            <Chip
              key={days}
              label={t('founderAnalytics', PERIOD_LABEL[days])}
              selected={days === period}
              onPress={() => onPeriod?.(days)}
            />
          ))}
        </Chips>
        {data === undefined ? null : (
          <Small>{t('founderAnalytics', 'from_date', { date: dayOf(data.since) })}</Small>
        )}
        {empty ? (
          <Stack gap={6}>
            <DisplayL>{t('founderAnalytics', 'empty_title')}</DisplayL>
            <BodyText>{t('founderAnalytics', 'empty_detail')}</BodyText>
          </Stack>
        ) : (
          <>
            <NorthStarSection months={data.north_star} />
            <GatesSection data={data} />
            <FunnelSection data={data} />
            <AdoptionSection data={data} />
            <Small>{t('founderAnalytics', 'never_split')}</Small>
          </>
        )}
      </Body>
    </Screen>
  );
}

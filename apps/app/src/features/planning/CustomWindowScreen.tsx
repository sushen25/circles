import {
  Body,
  Button,
  CompactButton,
  DayGrid,
  DisplayL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Title,
  TopBar,
} from '../../components';
import { Between, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import { BandPicker, type BandPickerProps } from './parts';
import type { CustomWindowView } from './useCustomWindow';

/**
 * CustomWindow — `docs/design/CustomWindow.dc.html` (spec §5.3): a month grid
 * to tap a range on, at most fourteen days, days already gone shown and not
 * pickable; then the hours of each day. **Use these dates** goes back to the
 * form it came from with the range and the hours on it.
 */
export type CustomWindowProps = {
  view: CustomWindowView;
  band: BandPickerProps;
  /** Why the dates and hours together do not work, from the domain's own code. */
  problem?: string | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CustomWindowScreen({ view, band, problem, onNext, onBack }: CustomWindowProps) {
  return (
    <Screen>
      <TopBar title={t('customWindow', 'when')} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{t('customWindow', 'pick_the_dates_to_ask_about')}</DisplayL>
        <Between>
          <Label>{view.monthTitle}</Label>
          <Row>
            <CompactButton
              label={t('customWindow', 'earlier_month')}
              disabled={!view.canEarlierMonth}
              onPress={view.onEarlierMonth}
            />
            <CompactButton
              label={t('customWindow', 'later_month')}
              disabled={!view.canLaterMonth}
              onPress={view.onLaterMonth}
            />
          </Row>
        </Between>
        <DayGrid
          days={view.days}
          weekdays={view.weekdays}
          label={t('customWindow', 'grid_label')}
          onToggle={view.onDay}
        />
        <Stack>
          <Title accessibilityLiveRegion="polite">{view.summary}</Title>
          {view.detail === '' ? null : <Small>{view.detail}</Small>}
        </Stack>
        <BandPicker {...band} />
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
      </Body>
      <Foot>
        <Button
          label={t('customWindow', 'use_these_dates')}
          disabled={view.range === undefined || problem !== undefined}
          onPress={onNext}
        />
      </Foot>
    </Screen>
  );
}

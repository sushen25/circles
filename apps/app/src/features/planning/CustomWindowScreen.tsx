import { StyleSheet, View } from 'react-native';

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
 * CustomWindow — `docs/design/CustomWindow.dc.html` (spec §5.3, ADR 0047): a
 * month grid of days to ask about, tapped one at a time or painted by dragging
 * across them, the first and last at most thirty days apart, days already
 * gone shown and not pickable; then the hours of each day. **Start over**
 * clears the days and offers **Undo** until the next change. **Use these
 * dates** goes back to the form it came from with the days and the hours.
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
          onPaint={view.paint}
        />
        <Between>
          <View style={styles.summary}>
            <Stack>
              <Title accessibilityLiveRegion="polite">{view.summary}</Title>
              {view.detail === '' ? null : <Small>{view.detail}</Small>}
            </Stack>
          </View>
          {view.onStartOver === undefined ? null : (
            <CompactButton
              label={t('customWindow', 'start_over')}
              icon="x"
              onPress={view.onStartOver}
            />
          )}
          {view.onUndo === undefined ? null : (
            <CompactButton label={t('customWindow', 'undo')} tone="accent" onPress={view.onUndo} />
          )}
        </Between>
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

const styles = StyleSheet.create({
  // The words take what the button leaves; a long run of days wraps.
  summary: { flex: 1 },
});

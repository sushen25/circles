import { Chip, Chips, CompactButton, Label, Small, Tertiary, Title } from '../../components';
import { Between, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import { DAYTIME, EVENINGS, type BandKind } from './bands';
import { bandWords } from './words';

/**
 * The pieces the plan screens share: a line with a Change beside it, a
 * stepper, and the times-of-day picker. Presentational — every word arrives
 * worked out, or is a copy key.
 */

export function SettingLine({
  title,
  detail,
  onChange,
}: {
  title: string;
  detail?: string | undefined;
  onChange?: (() => void) | undefined;
}) {
  return (
    <Between>
      <Stack>
        <Title>{title}</Title>
        {detail === undefined || detail === '' ? null : <Small>{detail}</Small>}
      </Stack>
      {onChange === undefined ? null : (
        <Tertiary
          label={t('planSetup', 'change')}
          accessibilityHint={t('planSetup', 'change_hint', { what: title })}
          onPress={onChange}
        />
      )}
    </Between>
  );
}

/** Fewer and More, each disabled at its end of the range rather than refusing. */
export function Stepper({
  onFewer,
  onMore,
  canFewer,
  canMore,
  fewerLabel,
  moreLabel,
  fewerSpoken,
  moreSpoken,
}: {
  onFewer: () => void;
  onMore: () => void;
  canFewer: boolean;
  canMore: boolean;
  fewerLabel: string;
  moreLabel: string;
  fewerSpoken: string;
  moreSpoken: string;
}) {
  return (
    <Row>
      <CompactButton
        label={fewerLabel}
        aria-label={fewerSpoken}
        disabled={!canFewer}
        onPress={onFewer}
      />
      <CompactButton
        label={moreLabel}
        aria-label={moreSpoken}
        disabled={!canMore}
        onPress={onMore}
      />
    </Row>
  );
}

export type BandPickerProps = {
  kind: BandKind;
  /** The band in play, for the custom edges and the cost line. */
  from: string;
  to: string;
  cells: number;
  onKind: (kind: BandKind) => void;
  onStep: (edge: 'start' | 'end', direction: 1 | -1) => void;
  canStep: (edge: 'start' | 'end', direction: 1 | -1) => boolean;
};

/**
 * Evenings, daytime, or any hours at all — half an hour at a time, so the
 * picker cannot produce a band the domain would refuse (`band_unaligned`).
 * Custom hours say what they cost: every half hour is a cell somebody scrolls.
 */
export function BandPicker({ kind, from, to, cells, onKind, onStep, canStep }: BandPickerProps) {
  const edge = (which: 'start' | 'end') => (
    <Between>
      <Title>
        {which === 'start'
          ? t('planSetup', 'from', { time: from })
          : t('planSetup', 'to', { time: to })}
      </Title>
      <Stepper
        fewerLabel={t('planSetup', 'earlier')}
        moreLabel={t('planSetup', 'later')}
        fewerSpoken={
          which === 'start' ? t('planSetup', 'start_earlier') : t('planSetup', 'end_earlier')
        }
        moreSpoken={which === 'start' ? t('planSetup', 'start_later') : t('planSetup', 'end_later')}
        canFewer={canStep(which, -1)}
        canMore={canStep(which, 1)}
        onFewer={() => onStep(which, -1)}
        onMore={() => onStep(which, 1)}
      />
    </Between>
  );

  return (
    <Stack gap={10}>
      <Label>{t('planSetup', 'times_of_day')}</Label>
      <Chips>
        <Chip
          label={t('planSetup', 'evenings')}
          detail={bandWords(EVENINGS)}
          selected={kind === 'evenings'}
          onPress={() => onKind('evenings')}
        />
        <Chip
          label={t('planSetup', 'daytime')}
          detail={bandWords(DAYTIME)}
          selected={kind === 'daytime'}
          onPress={() => onKind('daytime')}
        />
        <Chip
          label={t('planSetup', 'custom_times')}
          selected={kind === 'custom'}
          onPress={() => onKind('custom')}
        />
      </Chips>
      {kind === 'custom' ? (
        <Stack gap={8}>
          {edge('start')}
          {edge('end')}
        </Stack>
      ) : null}
      <Small>{t('planSetup', 'band_cells', { count: cells })}</Small>
    </Stack>
  );
}

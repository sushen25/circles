import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, faceFor, hit, radius } from '@circles/tokens';

import { BodyText, Button, DisplayL, Icon, Sheet, Tertiary, usePalette } from '../../components';
import { t } from '../../copy';
import type { BlockKind } from './blocks';
import type { SheetView } from './view';

/**
 * "Change time" (SUS-206, ADR 0068): one time of day for every day the person
 * tapped. Each choice applies at once, so Done only lets go of the sheet. The
 * half hours are one link away, for the answer that is not a block.
 */
type Props = {
  visible: boolean;
  sheet: SheetView | undefined;
  onChoose?: ((kind: BlockKind) => void) | undefined;
  onExactHours?: (() => void) | undefined;
  onDone?: (() => void) | undefined;
};

export function ChangeTimeSheet({ visible, sheet, onChoose, onExactHours, onDone }: Props) {
  return (
    <Sheet
      visible={visible && sheet !== undefined}
      onDismiss={() => onDone?.()}
      label={t('availability', 'sheet_title')}
      dismissLabel={t('availability', 'sheet_dismiss')}
    >
      {sheet === undefined ? null : (
        <>
          <View style={styles.head}>
            <DisplayL>{t('availability', 'sheet_title')}</DisplayL>
            <BodyText>{sheet.covers}</BodyText>
          </View>
          <View role="radiogroup" aria-label={t('availability', 'sheet_title')} style={styles.list}>
            {sheet.choices.map((choice) => (
              <Choice
                key={choice.kind}
                label={choice.label}
                detail={choice.detail}
                on={choice.on}
                onPress={() => onChoose?.(choice.kind)}
              />
            ))}
          </View>
          <Tertiary label={t('availability', 'different_time_each_day')} onPress={onExactHours} />
          <Button label={t('availability', 'done')} onPress={onDone} />
        </>
      )}
    </Sheet>
  );
}

function Choice({
  label,
  detail,
  on,
  onPress,
}: {
  label: string;
  detail: string | undefined;
  on: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      role="radio"
      aria-checked={on}
      aria-label={detail === undefined ? label : `${label}, ${detail}`}
      onPress={onPress}
      style={[
        styles.choice,
        { backgroundColor: palette.surface, borderColor: palette.lineStrong },
        on && { backgroundColor: color.accentSoft, borderColor: palette.accent },
      ]}
    >
      <View style={styles.words}>
        <Text style={[styles.label, { color: palette.ink }]}>{label}</Text>
        {detail === undefined ? null : (
          <Text style={[styles.detail, { color: palette.ink2 }]}>{detail}</Text>
        )}
      </View>
      {on ? <Icon name="check" size={20} color={palette.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { gap: 6 },
  list: { gap: 10 },
  choice: {
    minHeight: hit + 16,
    borderRadius: radius.card,
    borderWidth: 1.5,
    paddingHorizontal: 18,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  words: { gap: 2, flexShrink: 1 },
  label: { fontFamily: faceFor('Figtree', 600), fontSize: 17 },
  detail: { fontFamily: faceFor('Figtree', 400), fontSize: 13 },
});

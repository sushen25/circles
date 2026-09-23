import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Small, Title } from './Text';

/**
 * One setting: what it is, what it is set to, and the control that changes it
 * on the right — a switch, or a "Change" button (the canvas's Settings and
 * NotificationSettings rows). The words take the width that is left, so a long
 * circle name wraps instead of pushing the control off the screen.
 */
type Props = {
  title: string;
  detail?: string | undefined;
  children?: ReactNode;
};

export function SettingRow({ title, detail, children }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.words}>
        <Title>{title}</Title>
        {detail === undefined ? null : <Small>{detail}</Small>}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  words: {
    flex: 1,
    gap: 2,
  },
});

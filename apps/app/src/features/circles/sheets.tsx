import {
  BodyText,
  Button,
  Radio,
  SettingRow,
  Sheet,
  Small,
  Tertiary,
  Title,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * The two bottom sheets circle settings, notification settings and account
 * are made of: a question with one answer that does something ("Reset link?",
 * "Remove Priya?", "Archive Sunday Crew?"), and a choice among a few
 * ("How often would you like to catch up?"). Presentational; the flow decides
 * what each one says and does.
 */

export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  busy = false,
  problem,
  onConfirm,
  onDismiss,
}: {
  visible: boolean;
  title: string;
  body?: string | undefined;
  confirmLabel: string;
  busy?: boolean | undefined;
  problem?: string | undefined;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      label={title}
      dismissLabel={t('common', 'cancel')}
    >
      <Stack>
        <Title>{title}</Title>
        {body === undefined ? null : <BodyText>{body}</BodyText>}
      </Stack>
      {problem === undefined ? null : <Small accessibilityLiveRegion="polite">{problem}</Small>}
      <Button label={confirmLabel} variant="secondary" disabled={busy} onPress={onConfirm} />
      <Tertiary label={t('common', 'cancel')} onPress={onDismiss} />
    </Sheet>
  );
}

export type PickerOption<V extends string> = { value: V; label: string };

export function PickerSheet<V extends string>({
  visible,
  title,
  hint,
  options,
  selected,
  onPick,
  onDismiss,
}: {
  visible: boolean;
  title: string;
  hint?: string | undefined;
  options: readonly PickerOption<V>[];
  selected: V | undefined;
  onPick: (value: V) => void;
  onDismiss: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      label={title}
      dismissLabel={t('common', 'close')}
    >
      <Stack>
        <Title>{title}</Title>
        {hint === undefined ? null : <Small>{hint}</Small>}
      </Stack>
      <Stack gap={0}>
        {options.map((option) => (
          <SettingRow key={option.value} title={option.label}>
            <Radio
              selected={option.value === selected}
              label={option.label}
              onPress={() => onPick(option.value)}
            />
          </SettingRow>
        ))}
      </Stack>
      <Tertiary label={t('common', 'close')} onPress={onDismiss} />
    </Sheet>
  );
}

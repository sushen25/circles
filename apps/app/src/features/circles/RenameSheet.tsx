import type { IdempotencyKey } from '@circles/contracts';
import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
import { useRef, useState } from 'react';

import { BodyText, Button, Input, Label, Notice, Sheet, Tertiary, Title } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { renameInCircle } from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { failureOf } from '../identity/join/failure';

/**
 * "Change my name here" (SUS-205, ADR 0070): the join screen's name field in a
 * sheet over circle settings, for the name this one circle calls the reader.
 *
 * Mounted only while open, so every opening starts from the current name with
 * no old problem showing. The refusals are the join screen's, said in its
 * words: a taken name or an unusable one keeps the sheet open to type another;
 * only a success closes it. The account name and every other circle are not
 * touched, and the sheet says so in the sentence the join screen uses.
 */
export function RenameSheet({
  circleId,
  circleName,
  currentName,
  onDone,
  onClose,
}: {
  circleId: string;
  circleName: string;
  currentName: string;
  /** It went through: the caller refreshes what shows names, then closes. */
  onDone: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  // One key per *name*, not per tap (ADR 0016): a retry of the same name is
  // answered from the record, and a different name is a different request.
  const keys = useRef(new Map<string, IdempotencyKey>());

  const submit = async () => {
    const clean = normaliseDisplayName(name);
    if (clean === '' || busy) return;
    if (!isValidDisplayName(clean)) {
      setProblem(t('name', 'name_unusable'));
      return;
    }
    let key = keys.current.get(clean);
    if (key === undefined) {
      key = newIdempotencyKey();
      keys.current.set(clean, key);
    }
    setBusy(true);
    setProblem(undefined);
    try {
      await renameInCircle(circleId, clean, key);
      await onDone();
    } catch (error) {
      const failure = failureOf(error);
      setProblem(
        failure.kind === 'offline'
          ? t('name', 'youre_offline')
          : failure.kind === 'reason' && failure.reason === 'duplicate_name'
            ? t('name', 'name_taken', { circle: circleName, name: clean })
            : failure.kind === 'reason' && failure.reason === 'display_name_unusable'
              ? t('name', 'name_unusable')
              : failure.kind === 'reason' && failure.reason === 'too_many_requests'
                ? t('name', 'too_many_tries')
                : t('settings', 'couldnt_rename'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible
      onDismiss={onClose}
      label={t('settings', 'rename_title', { circle: circleName })}
      dismissLabel={t('common', 'cancel')}
    >
      <Stack>
        <Title>{t('settings', 'rename_title', { circle: circleName })}</Title>
        <BodyText>{t('name', 'just_for_this_circle', { circle: circleName })}</BodyText>
      </Stack>
      <Stack>
        <Label nativeID="rename-name-label">{t('name', 'your_name')}</Label>
        <Input
          accessibilityLabelledBy="rename-name-label"
          aria-label={t('name', 'your_name')}
          placeholder={t('name', 'your_first_name')}
          autoFocus
          value={name}
          onChangeText={(text) => {
            setName(text);
            setProblem(undefined);
          }}
          onSubmitEditing={() => void submit()}
          autoCapitalize="words"
          autoComplete="given-name"
          autoCorrect={false}
          maxLength={80}
          returnKeyType="done"
          editable={!busy}
        />
      </Stack>
      {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
      <Button
        label={t('settings', 'rename_save')}
        busyLabel={t('settings', 'rename_saving')}
        busy={busy}
        disabled={normaliseDisplayName(name) === ''}
        onPress={() => void submit()}
      />
      <Tertiary label={t('common', 'cancel')} onPress={onClose} />
    </Sheet>
  );
}

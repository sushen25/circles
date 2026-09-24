import { NOTE_MAX_LENGTH, OUTCOMES, type Outcome } from '@circles/domain';
import { Fragment } from 'react';

import {
  Body,
  BodyText,
  Button,
  Card,
  Chip,
  Chips,
  DisplayXL,
  Foot,
  Input,
  Label,
  Notice,
  Radio,
  Screen,
  SettingRow,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { MorningAfterWords } from './morningAfter';
import { MorningPlaceholder, type MorningState } from './morningParts';

/**
 * Outcome — `docs/design/Outcome.dc.html` (spec §5.10): "Did Thursday's
 * catch-up happen?", four answers, and a line for the circle's record.
 *
 * **Nothing is chosen for them.** The artboard draws "It happened" ticked; the
 * screen starts with nothing ticked and Save waiting, because the first answer
 * is the north-star metric (§11.1), and a default is an answer the organiser
 * did not give.
 *
 * **"Did the plan change outside the app?" is its own tap** — the micro-survey's
 * second question (§5.10), the evidence for H2 — and Save waits for it too. A
 * catch-up that happened at a time the chat settled on changed outside the app
 * as much as one moved there wholesale, so it is not read off the answer above;
 * choosing "We moved it outside" only fills in the obvious yes.
 *
 * `answered` is somebody coming back after reporting — to the same link, or
 * from circle home — and it says so rather than offering a form the server
 * would refuse (`outcome_already_reported`).
 *
 * Presentational. The flow owns the read, the write and where Save goes.
 */
export type OutcomeState = MorningState | 'answered';

function outcomeLabel(outcome: Outcome): string {
  switch (outcome) {
    case 'happened':
      return t('outcome', 'it_happened');
    case 'cancelled':
      return t('outcome', 'it_was_cancelled');
    case 'moved_outside':
      return t('outcome', 'we_moved_it_outside_brand');
    case 'not_sure':
      return t('outcome', 'not_sure');
  }
}

export type OutcomeProps = {
  state?: OutcomeState | undefined;
  words?: MorningAfterWords | undefined;
  choice?: Outcome | undefined;
  onChoose?: ((outcome: Outcome) => void) | undefined;
  note?: string | undefined;
  onNote?: ((note: string) => void) | undefined;
  /** "Did the plan change outside the app?" — undefined until answered. */
  changed?: boolean | undefined;
  onChanged?: ((changed: boolean) => void) | undefined;
  /** After an answer: the organiser's own "were you there?", when it is theirs to give. */
  onOwnAttendance?: (() => void) | undefined;
  busy?: boolean | undefined;
  /** Why the last Save did not land. */
  notice?: string | undefined;
  /** The screen's one decision. */
  onSave?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onToCircle?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function OutcomeScreen({
  state = 'default',
  words,
  choice,
  onChoose,
  note = '',
  onNote,
  changed,
  onChanged,
  onOwnAttendance,
  busy = false,
  notice,
  onSave,
  onRetry,
  onToCircle,
  onBack,
}: OutcomeProps) {
  if (state === 'answered' && words !== undefined) {
    return (
      <Screen>
        <TopBar title={words.circle} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Stack>
            <BodyText accessibilityLiveRegion="polite">{t('outcome', 'answered_title')}</BodyText>
            <Small>{t('outcome', 'answered_body')}</Small>
          </Stack>
        </Body>
        <Foot>
          {onToCircle === undefined ? null : (
            <Button
              label={t('outcome', 'back_to_circle', { circle: words.circle })}
              onPress={onToCircle}
            />
          )}
          {onOwnAttendance === undefined ? null : (
            <Tertiary label={t('outcome', 'own_attendance')} onPress={onOwnAttendance} />
          )}
        </Foot>
      </Screen>
    );
  }
  if (state !== 'default' || words === undefined) {
    return (
      <MorningPlaceholder
        screen="outcome"
        state={state === 'default' || state === 'answered' ? 'loading' : state}
        words={words}
        onRetry={onRetry}
        onToCircle={onToCircle}
        onBack={onBack}
      />
    );
  }

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('outcome', 'label', { circle: words.circle, date: words.date })}</Label>
          <DisplayXL>{t('outcome', 'title', { day: words.day })}</DisplayXL>
          <BodyText>{t('outcome', 'it_just_sets_when_the_circle_last')}</BodyText>
        </Stack>
        <Card>
          <Stack gap={8}>
            {OUTCOMES.map((outcome, index) => (
              <Fragment key={outcome}>
                {index === 0 ? null : <Divider />}
                <SettingRow title={outcomeLabel(outcome)}>
                  <Radio
                    selected={choice === outcome}
                    label={outcomeLabel(outcome)}
                    onPress={() => onChoose?.(outcome)}
                  />
                </SettingRow>
              </Fragment>
            ))}
          </Stack>
        </Card>
        <Stack gap={10}>
          <BodyText>{t('outcome', 'changed_question')}</BodyText>
          <Chips>
            <Chip
              label={t('outcome', 'changed_yes')}
              selected={changed === true}
              onPress={onChanged === undefined ? undefined : () => onChanged(true)}
            />
            <Chip
              label={t('outcome', 'changed_no')}
              selected={changed === false}
              onPress={onChanged === undefined ? undefined : () => onChanged(false)}
            />
          </Chips>
          <Small>{t('outcome', 'changed_hint')}</Small>
        </Stack>
        <Stack>
          <Label>{t('outcome', 'a_line_for_the_circles_record_optional')}</Label>
          <Input
            value={note}
            onChangeText={onNote}
            maxLength={NOTE_MAX_LENGTH}
            placeholder={t('outcome', 'note_placeholder')}
            accessibilityLabel={t('outcome', 'a_line_for_the_circles_record_optional')}
            editable={!busy}
          />
        </Stack>
        {notice === undefined ? null : <Notice kind="warn">{notice}</Notice>}
      </Body>
      <Foot>
        <Button
          label={busy ? t('outcome', 'saving') : t('outcome', 'save')}
          disabled={busy || choice === undefined || changed === undefined}
          onPress={onSave}
        />
      </Foot>
    </Screen>
  );
}

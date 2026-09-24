import { NOTE_MAX_LENGTH, type Outcome } from '@circles/domain';
import { Fragment } from 'react';

import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Foot,
  Input,
  Label,
  Notice,
  Radio,
  Screen,
  SettingRow,
  Small,
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
 * did not give. "Did the plan change outside the app?" is not asked again: it
 * is the third answer, and the flow sends it as such.
 *
 * `answered` is somebody coming back after reporting — to the same link, or
 * from circle home — and it says so rather than offering a form the server
 * would refuse (`outcome_already_reported`).
 *
 * Presentational. The flow owns the read, the write and where Save goes.
 */
export type OutcomeState = MorningState | 'answered';

export const OUTCOMES: readonly Outcome[] = ['happened', 'cancelled', 'moved_outside', 'not_sure'];

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
        {onToCircle === undefined ? null : (
          <Foot>
            <Button
              label={t('outcome', 'back_to_circle', { circle: words.circle })}
              onPress={onToCircle}
            />
          </Foot>
        )}
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
          disabled={busy || choice === undefined}
          onPress={onSave}
        />
      </Foot>
    </Screen>
  );
}

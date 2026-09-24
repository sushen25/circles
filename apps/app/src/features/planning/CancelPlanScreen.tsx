import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Input,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ScreenState } from '../state';
import { PlanStateScreen } from './states';

/**
 * CancelPlan — `docs/design/CancelPlan.dc.html` (spec §5.7): a final state,
 * with something to say about it. The note is optional and is the
 * organiser's own words: it goes to the circle with the cancellation and
 * never into a log or an analytics payload (non-negotiable 8).
 */
export const NOTE_MAX = 280;

export type CancelPlanProps = {
  state?: ScreenState | undefined;
  statement?: { title: string; body: string } | undefined;
  /** "Thursday", when the plan was locked in; nothing while it was asking. */
  day?: string | undefined;
  /** Whether it was locked in, which changes what "off" costs. */
  lockedIn?: boolean | undefined;
  note?: string | undefined;
  onNote?: ((note: string) => void) | undefined;
  refused?: string | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: Cancel the catch-up. */
  onNext?: (() => void) | undefined;
  onKeepIt?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CancelPlanScreen(props: CancelPlanProps) {
  const { state = 'default', day, note = '', busy = false } = props;
  if (state !== 'default' || props.statement !== undefined) {
    return (
      <PlanStateScreen
        state={state === 'default' ? 'denied' : state}
        title={props.statement?.title}
        body={props.statement?.body}
        onRetry={props.onRetry}
        onBack={props.onBack}
      />
    );
  }

  return (
    <Screen>
      <TopBar
        title={t('cancelPlan', 'back')}
        onBack={props.onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>
            {day === undefined
              ? t('cancelPlan', 'title_plain')
              : t('cancelPlan', 'title_day', { day })}
          </DisplayL>
          <BodyText>
            {props.lockedIn === false
              ? t('cancelPlan', 'body_asking')
              : t('cancelPlan', 'everyone_will_see_its_off_the_circles')}
          </BodyText>
        </Stack>
        <Stack>
          <Label>{t('cancelPlan', 'a_short_note_optional')}</Label>
          <Input
            aria-label={t('cancelPlan', 'a_short_note_optional')}
            placeholder={t('cancelPlan', 'work_thing_came_up_sorry_all_will')}
            value={note}
            onChangeText={props.onNote}
            maxLength={NOTE_MAX}
            multiline
            editable={!busy}
          />
          <Small>{t('cancelPlan', 'note_count', { count: note.length, total: NOTE_MAX })}</Small>
        </Stack>
        <Small>{t('cancelPlan', 'well_give_you_a_message_to_paste')}</Small>
        {props.refused === undefined ? null : <Notice kind="warn">{props.refused}</Notice>}
        {props.reference === undefined ? null : (
          <Small>{t('planSetup', 'reference', { reference: props.reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={busy ? t('cancelPlan', 'cancelling') : t('cancelPlan', 'cancel_the_catch_up')}
          disabled={busy}
          onPress={props.onNext}
        />
        <Tertiary label={t('cancelPlan', 'keep_it')} onPress={props.onKeepIt} />
      </Foot>
    </Screen>
  );
}

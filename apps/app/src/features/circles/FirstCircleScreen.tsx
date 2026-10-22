import {
  BrandLockup,
  Body,
  Button,
  DisplayL,
  type Go,
  Foot,
  Input,
  MessageBubble,
  Notice,
  Screen,
  Step,
  Tertiary,
  TopBar,
  useStepMotion,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * FirstCircle — screen 1 of the first run (SUS-247, spec §5.1): one question,
 * "Who do you keep meaning to see?", and under the field the first line of the
 * message their group will get, filling in as they type. Nothing is created
 * and nothing is chosen but a name: cadence left the first run (ADR 0090), and a
 * new circle stays monthly.
 *
 * The heading is the field's label, so the screen has one question and says it
 * once. The primary is **Next**, because nothing is made yet.
 */
export type CircleCadence = 'weekly' | 'fortnightly' | 'monthly' | 'two_monthly' | 'none';

export type FirstCircleProblem = 'name_unusable';

export type FirstCircleProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  name?: string | undefined;
  problem?: FirstCircleProblem | undefined;
  /** How many screens this run has before the share: 3 for a new organiser, 2 once signed in. */
  steps?: 2 | 3 | undefined;
  onNameChange?: ((name: string) => void) | undefined;
  /**
   * The screen's one decision. The flow validates, and calls `go` with the
   * navigation once it may, so the step leaves only when it is really going.
   */
  onNext?: ((go: Go) => void) | undefined;
  onBack?: (() => void) | undefined;
  /**
   * The front door of the first run, for somebody with no account (ADR 0053):
   * the wordmark in the top bar and a quiet Sign in for a returning organiser.
   * Absent, this is the same form reached from the circles list, with a way
   * back.
   */
  onSignIn?: (() => void) | undefined;
};

/** "1 of 3", for the top bar of any screen in the run. */
export function stepOf(at: number, total: number) {
  return {
    at,
    total,
    label: t('firstRun', 'step_of', { at, total }),
    spoken: t('firstRun', 'step_spoken', { at, total }),
  };
}

export function FirstCircleScreen({
  name = '',
  problem,
  steps = 3,
  onNameChange,
  onNext,
  onBack,
  onSignIn,
}: FirstCircleProps) {
  const motion = useStepMotion();
  const leave = motion.leave;
  const typed = name.trim().replace(/\s+/g, ' ');
  const group = typed === '' ? t('firstRun', 'preview_group_empty') : typed;
  const link = t('firstRun', 'preview_link');

  return (
    <Screen>
      <TopBar
        left={onSignIn === undefined ? undefined : <BrandLockup size={22} />}
        onBack={onBack === undefined ? undefined : () => leave('back', onBack)}
        backLabel={t('common', 'back')}
        step={stepOf(1, steps)}
        right={
          onSignIn === undefined ? undefined : (
            <Tertiary
              label={t('firstCircle', 'sign_in')}
              accessibilityHint={t('firstCircle', 'sign_in_hint')}
              onPress={onSignIn}
            />
          )
        }
      />
      <Step motion={motion}>
        <Body>
          <Stack gap={14}>
            <DisplayL nativeID="group-heading">
              {t('firstCircle', 'who_do_you_keep_meaning_to_see')}
            </DisplayL>
            <Input
              aria-labelledby="group-heading"
              placeholder={t('firstRun', 'group_hint')}
              autoFocus
              value={name}
              onChangeText={onNameChange}
              autoCapitalize="words"
              maxLength={40}
              returnKeyType="next"
              onSubmitEditing={() => onNext?.((navigate) => leave('forward', navigate))}
            />
            {problem === undefined ? null : (
              <Notice kind="warn">{t('firstRun', 'group_unusable')}</Notice>
            )}
          </Stack>
          <MessageBubble
            to={
              typed === ''
                ? t('firstRun', 'preview_to_empty')
                : t('firstRun', 'preview_to', { group })
            }
            message={t('firstRun', 'preview_first_line', { group, link })}
            mark={[group, link]}
            hollow={typed === '' ? [group] : []}
            caption={t('firstRun', 'preview_caption')}
          />
        </Body>
        <Foot>
          <Button
            label={t('firstRun', 'next')}
            onPress={() => onNext?.((navigate) => leave('forward', navigate))}
          />
        </Foot>
      </Step>
    </Screen>
  );
}

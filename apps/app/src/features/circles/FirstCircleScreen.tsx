import {
  Body,
  BodyText,
  Button,
  Chip,
  Chips,
  DisplayL,
  Foot,
  Input,
  Label,
  Notice,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * FirstCircle — `docs/design/FirstCircle.dc.html` (spec §5.1 step 4).
 *
 * A name and a loose cadence, and nothing else: the circle's name is the
 * second and last typed input on the way to an invite link. The button says
 * what it will make, in the person's own words, once they have typed some.
 */
export type CircleCadence = 'weekly' | 'fortnightly' | 'monthly' | 'two_monthly' | 'none';

export type FirstCircleProblem = 'name_unusable' | 'too_many_tries' | 'couldnt_create' | 'offline';

export type FirstCircleProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  name?: string | undefined;
  cadence?: CircleCadence | undefined;
  problem?: FirstCircleProblem | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onNameChange?: ((name: string) => void) | undefined;
  onCadenceChange?: ((cadence: CircleCadence) => void) | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

const CADENCES: readonly [CircleCadence, () => string][] = [
  ['weekly', () => t('firstCircle', 'weekly')],
  ['fortnightly', () => t('firstCircle', 'fortnightly')],
  ['monthly', () => t('firstCircle', 'monthly')],
  ['two_monthly', () => t('firstCircle', 'every_two_months')],
  ['none', () => t('firstCircle', 'no_goal')],
];

function problemCopy(problem: FirstCircleProblem): string {
  switch (problem) {
    case 'name_unusable':
      return t('firstCircle', 'name_unusable');
    case 'too_many_tries':
      return t('firstCircle', 'too_many_tries');
    case 'couldnt_create':
      return t('firstCircle', 'couldnt_create');
    case 'offline':
      return t('firstCircle', 'youre_offline');
  }
}

export function FirstCircleScreen({
  name = '',
  cadence = 'monthly',
  problem,
  reference,
  busy = false,
  onNameChange,
  onCadenceChange,
  onNext,
  onBack,
}: FirstCircleProps) {
  const typed = name.trim().replace(/\s+/g, ' ');

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('firstCircle', 'step_1_of_2')}</Label>
          <DisplayL>{t('firstCircle', 'who_do_you_keep_meaning_to_see')}</DisplayL>
          <BodyText>{t('firstCircle', 'a_circle_is_one_group_of_friends')}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('firstCircle', 'circle_name')}</Label>
          <Input
            aria-label={t('firstCircle', 'circle_name')}
            placeholder={t('firstCircle', 'sunday_crew')}
            value={name}
            onChangeText={onNameChange}
            autoCapitalize="words"
            maxLength={40}
            onSubmitEditing={onNext}
          />
        </Stack>
        <Stack>
          <Label>{t('firstCircle', 'how_often_would_you_like_to_catch')}</Label>
          <Chips>
            {CADENCES.map(([value, label]) => (
              <Chip
                key={value}
                label={label()}
                selected={cadence === value}
                onPress={() => onCadenceChange?.(value)}
              />
            ))}
          </Chips>
          <Small>{t('firstCircle', 'a_loose_aim_not_a_rule_nobody')}</Small>
        </Stack>
        {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('firstCircle', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={
            busy
              ? t('firstCircle', 'creating')
              : typed === ''
                ? t('firstCircle', 'create_circle')
                : t('firstCircle', 'create_named', { name: typed })
          }
          onPress={onNext}
          disabled={busy}
        />
        <Small>{t('firstCircle', 'you_can_change_anything_later')}</Small>
      </Foot>
    </Screen>
  );
}

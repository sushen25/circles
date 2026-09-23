import {
  Body,
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
  Swatches,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import type { CircleCadence } from './FirstCircleScreen';

/**
 * CreateCircle — `docs/design/CreateCircle.dc.html`: a second circle, from the
 * circles list, with everything the first run leaves for later (spec §5.2) —
 * a name, a colour, a rhythm and roughly where. Only the name is required.
 *
 * Presentational: the flow holds the values and sends them.
 */
export type CreateCircleProblem = 'name_unusable' | 'too_many' | 'couldnt_create' | 'offline';

export type CreateCircleProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  name?: string | undefined;
  color?: string | undefined;
  cadence?: CircleCadence | undefined;
  area?: string | undefined;
  problem?: CreateCircleProblem | undefined;
  busy?: boolean | undefined;
  onNameChange?: ((text: string) => void) | undefined;
  onColorChange?: ((token: string) => void) | undefined;
  onCadenceChange?: ((cadence: CircleCadence) => void) | undefined;
  onAreaChange?: ((text: string) => void) | undefined;
  /** The screen's one decision: create it. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

const PROBLEMS: Record<CreateCircleProblem, () => string> = {
  name_unusable: () => t('createCircle', 'name_unusable'),
  too_many: () => t('createCircle', 'too_many'),
  couldnt_create: () => t('createCircle', 'couldnt_create'),
  offline: () => t('createCircle', 'youre_offline'),
};

const CADENCES: readonly [CircleCadence, () => string][] = [
  ['weekly', () => t('createCircle', 'weekly')],
  ['fortnightly', () => t('createCircle', 'fortnightly')],
  ['monthly', () => t('createCircle', 'monthly')],
  ['two_monthly', () => t('createCircle', 'every_two_months')],
  ['none', () => t('createCircle', 'no_goal')],
];

const COLOR_NAMES: Record<string, () => string> = {
  clay: () => t('createCircle', 'color_clay'),
  moss: () => t('createCircle', 'color_moss'),
  plum: () => t('createCircle', 'color_plum'),
  sky: () => t('createCircle', 'color_sky'),
  ochre: () => t('createCircle', 'color_ochre'),
};

/** A colour's spoken name; a token the copy does not know is read as itself. */
export function colorName(token: string): string {
  return COLOR_NAMES[token]?.() ?? token;
}

export function CreateCircleScreen({
  state = 'default',
  name = '',
  color = 'clay',
  cadence = 'monthly',
  area = '',
  problem,
  busy = false,
  onNameChange,
  onColorChange,
  onCadenceChange,
  onAreaChange,
  onNext,
  onBack,
}: CreateCircleProps) {
  const top = (
    <TopBar
      title={t('createCircle', 'new_circle')}
      onBack={onBack}
      backLabel={t('common', 'back')}
    />
  );
  if (state === 'loading') {
    return (
      <Screen>
        {top}
        <Body>{null}</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      {top}
      <Body>
        <DisplayL>{t('createCircle', 'whos_this_for')}</DisplayL>
        <Stack>
          <Label>{t('createCircle', 'circle_name')}</Label>
          <Input
            aria-label={t('createCircle', 'circle_name')}
            placeholder={t('createCircle', 'sunday_crew')}
            value={name}
            onChangeText={onNameChange}
            autoCapitalize="words"
            maxLength={40}
          />
        </Stack>
        <Stack>
          <Label>{t('createCircle', 'colour')}</Label>
          <Swatches
            value={color}
            onChange={(token) => onColorChange?.(token)}
            labelFor={colorName}
            label={t('createCircle', 'colour')}
          />
        </Stack>
        <Stack>
          <Label>{t('createCircle', 'how_often_would_you_like_to_catch')}</Label>
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
          <Small>{t('createCircle', 'a_loose_aim_not_a_rule_well')}</Small>
        </Stack>
        <Stack>
          <Label>{t('createCircle', 'where_roughly')}</Label>
          <Input
            aria-label={t('createCircle', 'where_roughly')}
            placeholder={t('createCircle', 'inner_north_optional')}
            value={area}
            onChangeText={onAreaChange}
            maxLength={60}
          />
        </Stack>
        {problem === undefined ? null : <Notice kind="warn">{PROBLEMS[problem]()}</Notice>}
      </Body>
      <Foot>
        <Button
          label={busy ? t('createCircle', 'creating') : t('createCircle', 'create_circle')}
          onPress={onNext}
          disabled={busy}
        />
      </Foot>
    </Screen>
  );
}

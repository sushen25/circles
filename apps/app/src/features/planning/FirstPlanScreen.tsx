import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Between, Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * FirstPlan — `docs/design/FirstPlan.dc.html` (spec §5.1 step 7): one card of
 * defaults and **Ask the group**.
 *
 * Each line is worked out by the flow from the domain's rules; this draws them.
 * The quorum line says it adjusts as people join, because it does — the server
 * counts the members again when the plan is made.
 */
export type FirstPlanProblem = 'too_many_tries' | 'couldnt_ask' | 'offline';

export type FirstPlanProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  window?: string | undefined;
  band?: string | undefined;
  duration?: string | undefined;
  quorum?: string | undefined;
  closesIn?: string | undefined;
  closesAt?: string | undefined;
  problem?: FirstPlanProblem | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  /** Any "Change": the full plan setup (S1-26). */
  onChange?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: Ask the group. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSeeIfPeopleAre?: (() => void) | undefined;
};

function problemCopy(problem: FirstPlanProblem): string {
  switch (problem) {
    case 'too_many_tries':
      return t('firstPlan', 'too_many_tries');
    case 'couldnt_ask':
      return t('firstPlan', 'couldnt_ask');
    case 'offline':
      return t('firstPlan', 'youre_offline');
  }
}

function Line({
  title,
  detail,
  onChange,
}: {
  title: string;
  detail?: string | undefined;
  onChange?: (() => void) | undefined;
}) {
  return (
    <Between>
      <Stack>
        <Title>{title}</Title>
        {detail === undefined || detail === '' ? null : <Small>{detail}</Small>}
      </Stack>
      <Tertiary
        label={t('firstPlan', 'change')}
        accessibilityHint={t('firstPlan', 'change_hint', { what: title })}
        onPress={onChange}
      />
    </Between>
  );
}

export function FirstPlanScreen({
  state = 'default',
  circleName = t('firstPlan', 'sunday_crew'),
  window = t('firstPlan', 'catch_up_next_14_days'),
  band = t('firstPlan', 'evenings_and_weekend_days'),
  duration = t('firstPlan', 'about_2_hours'),
  quorum = t('firstPlan', 'at_least_2_of_3_need_to'),
  closesIn = t('firstPlan', 'replies_close_in_3_days'),
  closesAt = t('firstPlan', 'tue_15_sep_6_pm'),
  problem,
  reference,
  busy = false,
  onChange,
  onRetry,
  onNext,
  onBack,
  onSeeIfPeopleAre,
}: FirstPlanProps) {
  if (state === 'loading') {
    return (
      <Screen>
        <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('firstPlan', 'loading')}</Small>
        </Body>
      </Screen>
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayL>
            {state === 'offline' ? t('firstPlan', 'youre_offline') : t('firstPlan', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('firstPlan', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('firstPlan', 'your_first_catch_up')}</DisplayL>
          <BodyText>{t('firstPlan', 'weve_picked_sensible_defaults_tap_anything_to')}</BodyText>
        </Stack>
        <Card>
          <Line title={window} detail={band} onChange={onChange} />
          <Divider />
          <Line title={duration} onChange={onChange} />
          <Divider />
          <Line
            title={quorum}
            detail={t('firstPlan', 'adjusts_as_more_people_join')}
            onChange={onChange}
          />
          <Divider />
          <Line title={closesIn} detail={closesAt} onChange={onChange} />
        </Card>
        <Small>{t('firstPlan', 'friends_mark_the_times_theyd_actually_be')}</Small>
        {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('firstPlan', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={busy ? t('firstPlan', 'asking') : t('firstPlan', 'ask_the_group')}
          onPress={onNext}
          disabled={busy}
        />
        <Tertiary
          label={t('firstPlan', 'see_if_people_are_keen_instead')}
          onPress={onSeeIfPeopleAre}
        />
      </Foot>
    </Screen>
  );
}

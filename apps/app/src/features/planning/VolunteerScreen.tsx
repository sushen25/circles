import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Volunteer — `docs/design/Volunteer.dc.html` (spec §5.4.5): a keen member,
 * once the ask has opened and nobody has taken the role.
 *
 * **The count never says "so far".** Interest closes when the ask opens, so
 * the number is fixed from then on (ADR 0035) — which is what makes it
 * impossible to difference. Others can still send times, not interest.
 */
export type VolunteerProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  /** "Three people are keen to catch up this weekend." */
  headline?: string | undefined;
  /** "3 of 6 said they're keen. We don't show who." */
  keenLine?: string | undefined;
  busy?: boolean | undefined;
  problem?: string | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onNotThisOne?: (() => void) | undefined;
  onSendMyTimes?: (() => void) | undefined;
};

export function VolunteerScreen({
  circleName = t('volunteer', 'sunday_crew'),
  headline = t('volunteer', 'three_people_are_keen_for_this_weekend'),
  keenLine = t('volunteer', '3_of_6_are_keen_so_far'),
  busy = false,
  problem,
  onNext,
  onBack,
  onNotThisOne,
  onSendMyTimes,
}: VolunteerProps) {
  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('volunteer', 'started_quietly')}</Label>
          <DisplayXL>{headline}</DisplayXL>
          <BodyText>{t('volunteer', 'someone_needs_to_pick_the_time_it')}</BodyText>
        </Stack>
        {keenLine === '' ? null : (
          <Row>
            <Small>{keenLine}</Small>
          </Row>
        )}
        <Notice>{t('volunteer', 'this_plan_started_quietly_we_dont_say')}</Notice>
        {problem === undefined ? null : <Small accessibilityLiveRegion="polite">{problem}</Small>}
      </Body>
      <Foot>
        <Button
          label={busy ? t('volunteer', 'taking') : t('volunteer', 'ill_pick_the_time')}
          disabled={busy}
          onPress={onNext}
        />
        <Button
          label={t('volunteer', 'send_my_times')}
          variant="secondary"
          disabled={busy}
          onPress={onSendMyTimes}
        />
        <Tertiary label={t('volunteer', 'not_this_one')} onPress={onNotThisOne} />
      </Foot>
    </Screen>
  );
}

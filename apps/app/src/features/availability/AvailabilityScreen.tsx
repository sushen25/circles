import { useState } from 'react';

import {
  Body,
  BodyText,
  Button,
  Chip,
  Chips,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  Toggle,
  TopBar,
  Track,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Availability — scaffolded from `docs/design/Availability.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type AvailabilityProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onNoneOfTheseDates?: (() => void) | undefined;
};

export function AvailabilityScreen({
  fixture,
  onNext,
  onBack,
  onNoneOfTheseDates,
}: AvailabilityProps) {
  const [choice0, setChoice0] = useState(0); // Chip group
  const [cells0, setCells0] = useState(fixture.plan.cells); // Track
  const [cells1, setCells1] = useState(fixture.plan.cells); // Track
  const [cells2, setCells2] = useState(fixture.plan.cells); // Track
  const [cells3, setCells3] = useState(fixture.plan.cells); // Track
  const [toggle0, setToggle0] = useState(false); // Toggle

  return (
    <Screen>
      <TopBar
        title={t('availability', 'catch_up_next_14_days')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('availability', 'times_id_actually_be_up_for')}</DisplayL>
          <BodyText>{t('availability', 'catch_ups_run_about_2_hours_replies')}</BodyText>
        </Stack>
        <Chips>
          <Chip
            label={t('availability', 'after_work')}
            selected={choice0 === 0}
            onPress={() => setChoice0(0)}
          />
          <Chip
            label={t('availability', 'all_evening')}
            selected={choice0 === 1}
            onPress={() => setChoice0(1)}
          />
          <Chip
            label={t('availability', 'any_time_that_day')}
            selected={choice0 === 2}
            onPress={() => setChoice0(2)}
          />
        </Chips>
        <Stack>
          <Row>
            <Title>{t('availability', 'mon_14_sep')}</Title>
            <BodyText>{t('availability', '6_30_10_30_pm')}</BodyText>
          </Row>
          <Track
            day={fixture.plan.dayLabel}
            cells={cells0}
            onChange={setCells0}
            startMinutes={fixture.plan.startMinutes}
            busy={fixture.plan.busy}
            ticks={fixture.plan.ticks}
          />
          <BodyText>{t('availability', '5_30_pm')}</BodyText>
          <BodyText>{t('availability', '8_pm')}</BodyText>
          <BodyText>{t('availability', '10_30_pm')}</BodyText>
        </Stack>
        <Stack>
          <Row>
            <Title>{t('availability', 'tue_15_sep')}</Title>
            <BodyText>{t('availability', 'not_this_day')}</BodyText>
          </Row>
          <Track
            day={fixture.plan.dayLabel}
            cells={cells1}
            onChange={setCells1}
            startMinutes={fixture.plan.startMinutes}
            busy={fixture.plan.busy}
            ticks={fixture.plan.ticks}
          />
          <BodyText>{t('availability', '5_30_pm')}</BodyText>
          <BodyText>{t('availability', '8_pm')}</BodyText>
          <BodyText>{t('availability', '10_30_pm')}</BodyText>
        </Stack>
        <Stack>
          <Row>
            <Title>{t('availability', 'wed_16_sep')}</Title>
            <BodyText>{t('availability', '7_9_30_pm')}</BodyText>
          </Row>
          <Track
            day={fixture.plan.dayLabel}
            cells={cells2}
            onChange={setCells2}
            startMinutes={fixture.plan.startMinutes}
            busy={fixture.plan.busy}
            ticks={fixture.plan.ticks}
          />
          <BodyText>{t('availability', '5_30_pm')}</BodyText>
          <BodyText>{t('availability', '8_pm')}</BodyText>
          <BodyText>{t('availability', '10_30_pm')}</BodyText>
        </Stack>
        <Stack>
          <Row>
            <Title>{t('availability', 'thu_17_sep')}</Title>
            <BodyText>{t('availability', '5_30_10_30_pm')}</BodyText>
          </Row>
          <Track
            day={fixture.plan.dayLabel}
            cells={cells3}
            onChange={setCells3}
            startMinutes={fixture.plan.startMinutes}
            busy={fixture.plan.busy}
            ticks={fixture.plan.ticks}
          />
          <BodyText>{t('availability', '5_30_pm')}</BodyText>
          <BodyText>{t('availability', '8_pm')}</BodyText>
          <BodyText>{t('availability', '10_30_pm')}</BodyText>
        </Stack>
        <Row>
          <Stack>
            <Title>{t('availability', 'im_easy')}</Title>
            <Small>{t('availability', 'count_me_in_for_whatever_works_for')}</Small>
          </Stack>
          <Toggle
            value={toggle0}
            onValueChange={setToggle0}
            label={t('availability', 'count_me_in_for_whatever_works_for')}
          />
        </Row>
        <Notice>{t('availability', 'your_friends_will_only_see_a_combined')}</Notice>
      </Body>
      <Foot>
        <Button label={t('availability', 'send_my_times')} onPress={onNext} />
        <Tertiary
          label={t('availability', 'none_of_these_dates_work_for_me')}
          onPress={onNoneOfTheseDates}
        />
      </Foot>
    </Screen>
  );
}

import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
  Track,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * AvailabilityOverlay — scaffolded from `docs/design/AvailabilityOverlay.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type AvailabilityOverlayProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onNoneOfTheseDates?: (() => void) | undefined;
};

export function AvailabilityOverlayScreen({
  fixture,
  onNext,
  onBack,
  onNoneOfTheseDates,
}: AvailabilityOverlayProps) {
  return (
    <Screen>
      <TopBar
        title={t('availabilityOverlay', 'catch_up_next_14_days')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('availabilityOverlay', 'times_id_actually_be_up_for')}</DisplayL>
          <BodyText>{t('availabilityOverlay', 'catch_ups_run_about_2_hours_replies')}</BodyText>
        </Stack>
        <Row>
          <Row>
            <Small>{t('availabilityOverlay', 'greyed_from_personal_work_read_just_now')}</Small>
          </Row>
          <Small>{t('availabilityOverlay', 'change')}</Small>
        </Row>
        <Stack>
          <Row>
            <Title>{t('availabilityOverlay', 'mon_14_sep')}</Title>
            {t('availabilityOverlay', '8_10_30_pm')}
          </Row>
          <Track
            day={fixture.plan.dayLabel}
            cells={fixture.plan.cells}
            onChange={() => undefined}
            startMinutes={fixture.plan.startMinutes}
            busy={fixture.plan.busy}
            ticks={fixture.plan.ticks}
          />
          {t('availabilityOverlay', '5_30_pm')}
          {t('availabilityOverlay', '8_pm')}
          {t('availabilityOverlay', '10_30_pm')}
        </Stack>
        <Stack>
          <Row>
            <Title>{t('availabilityOverlay', 'tue_15_sep')}</Title>
            {t('availabilityOverlay', 'not_this_day')}
          </Row>
          <Track
            day={fixture.plan.dayLabel}
            cells={fixture.plan.cells}
            onChange={() => undefined}
            startMinutes={fixture.plan.startMinutes}
            busy={fixture.plan.busy}
            ticks={fixture.plan.ticks}
          />
          {t('availabilityOverlay', '5_30_pm')}
          {t('availabilityOverlay', '8_pm')}
          {t('availabilityOverlay', '10_30_pm')}
        </Stack>
        <Stack>
          <Row>
            <Title>{t('availabilityOverlay', 'wed_16_sep')}</Title>
            {t('availabilityOverlay', '7_9_30_pm')}
          </Row>
          <Track
            day={fixture.plan.dayLabel}
            cells={fixture.plan.cells}
            onChange={() => undefined}
            startMinutes={fixture.plan.startMinutes}
            busy={fixture.plan.busy}
            ticks={fixture.plan.ticks}
          />
          {t('availabilityOverlay', '5_30_pm')}
          {t('availabilityOverlay', '8_pm')}
          {t('availabilityOverlay', '10_30_pm')}
        </Stack>
        <Stack>
          <Row>
            <Title>{t('availabilityOverlay', 'thu_17_sep')}</Title>
            {t('availabilityOverlay', '5_30_10_30_pm')}
          </Row>
          <Track
            day={fixture.plan.dayLabel}
            cells={fixture.plan.cells}
            onChange={() => undefined}
            startMinutes={fixture.plan.startMinutes}
            busy={fixture.plan.busy}
            ticks={fixture.plan.ticks}
          />
          {t('availabilityOverlay', '5_30_pm')}
          {t('availabilityOverlay', '8_pm')}
          {t('availabilityOverlay', '10_30_pm')}
        </Stack>
        <Small>{t('availabilityOverlay', 'grey_means_your_calendar_says_busy_tap')}</Small>
        <Row>
          <Stack>
            <Title>{t('availabilityOverlay', 'im_easy')}</Title>
            <Small>{t('availabilityOverlay', 'count_me_in_for_whatever_works_for')}</Small>
          </Stack>
        </Row>
        <Notice>{t('availabilityOverlay', 'only_the_times_you_paint_are_sent')}</Notice>
      </Body>
      <Foot>
        <Button label={t('availabilityOverlay', 'send_my_times')} onPress={onNext} />
        <Tertiary
          label={t('availabilityOverlay', 'none_of_these_dates_work_for_me')}
          onPress={onNoneOfTheseDates}
        />
      </Foot>
    </Screen>
  );
}

import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Foot,
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
 * CalendarExplain — scaffolded from `docs/design/CalendarExplain.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CalendarExplainProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function CalendarExplainScreen({ onNext, onBack }: CalendarExplainProps) {
  return (
    <Screen>
      <TopBar
        title={t('calendarExplain', 'times_id_actually_be_up_for')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayXL>{t('calendarExplain', 'grey_out_clashes_from_your_calendar')}</DisplayXL>
          <BodyText>{t('calendarExplain', 'your_calendar_stays_on_this_phone_we')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Small>{t('calendarExplain', 'reads_busy_times_for_these_14_days')}</Small>
          </Row>
          <Row>
            <Small>{t('calendarExplain', 'runs_on_this_phone_only')}</Small>
          </Row>
          <Row>
            <Small>{t('calendarExplain', 'event_names_places_or_people')}</Small>
            <Small>{t('calendarExplain', 'never_leave_your_phone')}</Small>
          </Row>
          <Row>
            <Small>{t('calendarExplain', 'friends_see')}</Small>
            <Small>{t('calendarExplain', 'only_the_times_you_choose')}</Small>
          </Row>
        </Card>
        <Small>{t('calendarExplain', 'you_can_always_paint_over_a_greyed')}</Small>
      </Body>
      <Foot>
        <Button label={t('calendarExplain', 'choose_calendars')} onPress={onNext} />
        <Tertiary label={t('calendarExplain', 'keep_it_manual')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

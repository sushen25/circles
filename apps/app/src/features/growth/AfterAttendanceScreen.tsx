import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Label,
  Screen,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * AfterAttendance — scaffolded from `docs/design/AfterAttendance.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type AfterAttendanceProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onMaybeLater?: (() => void) | undefined;
};

export function AfterAttendanceScreen({ onNext, onBack, onMaybeLater }: AfterAttendanceProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('afterAttendance', 'sunday_crew_thu_17_sep')}</Label>
          <DisplayXL>{t('afterAttendance', 'glad_it_happened')}</DisplayXL>
          <BodyText>{t('afterAttendance', 'thats_the_first_one_sunday_crew_has')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Title>{t('afterAttendance', 'got_another_group_that_keeps_saying_we')}</Title>
          </Row>
          <BodyText>{t('afterAttendance', 'start_a_circle_for_them_same_link')}</BodyText>
          <Row>
            <Button label={t('afterAttendance', 'start_a_circle')} onPress={onNext} />
          </Row>
          <Tertiary label={t('afterAttendance', 'maybe_later')} onPress={onMaybeLater} />
        </Card>
      </Body>
    </Screen>
  );
}

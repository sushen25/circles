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
 * AfterAttendance — `docs/design/AfterAttendance.dc.html` (spec §5.11): after
 * "I was there" on the circle's first meetup, the one prompt that starts the
 * cross-circle loop. `AfterAttendanceFlow` decides whether it is shown.
 *
 * "Glad it happened." is said only here, after "I was there" — the neutral
 * "Thanks, noted." is the answer's own screen for either answer (manifesto
 * §3.5), and this replaces it only when the prompt has been let through.
 *
 * `guest` changes one sentence: a guest is told they would sign in first,
 * which is true only for them.
 */
export type AfterAttendanceProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  /** "Thu 17 Sep". */
  date?: string | undefined;
  guest?: boolean | undefined;
  /** Start a circle. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onMaybeLater?: (() => void) | undefined;
};

export function AfterAttendanceScreen({
  circleName = '',
  date = '',
  guest = true,
  onNext,
  onBack,
  onMaybeLater,
}: AfterAttendanceProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('afterAttendance', 'label', { circle: circleName, date })}</Label>
          <DisplayXL accessibilityLiveRegion="polite">
            {t('afterAttendance', 'glad_it_happened')}
          </DisplayXL>
          <BodyText>
            {t('afterAttendance', 'thats_the_first_one_circle_has', { circle: circleName })}
          </BodyText>
        </Stack>
        <Card>
          <Row>
            <Title>{t('afterAttendance', 'got_another_group_that_keeps_saying_we')}</Title>
          </Row>
          <BodyText>
            {guest
              ? t('afterAttendance', 'start_a_circle_for_them_same_link')
              : t('afterAttendance', 'start_a_circle_for_them_signed_in')}
          </BodyText>
          <Row>
            <Button label={t('afterAttendance', 'start_a_circle')} onPress={onNext} />
          </Row>
          <Tertiary label={t('afterAttendance', 'maybe_later')} onPress={onMaybeLater} />
        </Card>
      </Body>
    </Screen>
  );
}

import { Pressable } from 'react-native';

import {
  Body,
  BodyText,
  Card,
  DisplayXL,
  Foot,
  Label,
  Screen,
  Small,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * ThresholdRole — `docs/design/ThresholdRole.dc.html` (spec §5.4.5): the person
 * who asked, once enough people are keen. **I'll organise** takes the role;
 * **Ask for a volunteer** leaves it to the keen, who each already have a
 * one-tap "I'll pick the time" — the server lets any of them take it from the
 * moment it opens, so this is the initiator's choice, not a gate.
 */
export type ThresholdRoleProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  /** "Three of you want to catch up this weekend. …" — the count fixed when it opened. */
  body?: string | undefined;
  busy?: boolean | undefined;
  problem?: string | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onIllOrganise?: (() => void) | undefined;
  onAskForAVolunteer?: (() => void) | undefined;
};

function Choice({
  title,
  body,
  recommended = false,
  disabled = false,
  onPress,
}: {
  title: string;
  body: string;
  recommended?: boolean;
  disabled?: boolean;
  onPress?: (() => void) | undefined;
}) {
  return (
    <Pressable
      role="button"
      aria-label={`${title}. ${body}`}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
    >
      <Card recommended={recommended}>
        <Row>
          <Title>{title}</Title>
        </Row>
        <BodyText>{body}</BodyText>
      </Card>
    </Pressable>
  );
}

export function ThresholdRoleScreen({
  circleName = t('thresholdRole', 'sunday_crew'),
  body = t('thresholdRole', 'three_of_you_want_to_catch_up'),
  busy = false,
  problem,
  onBack,
  onIllOrganise,
  onAskForAVolunteer,
}: ThresholdRoleProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{circleName}</Label>
          <DisplayXL>{t('thresholdRole', 'enough_people_are_keen')}</DisplayXL>
          <BodyText>{body}</BodyText>
        </Stack>
        <Choice
          recommended
          title={busy ? t('thresholdRole', 'taking') : t('thresholdRole', 'ill_organise')}
          body={t('thresholdRole', 'your_name_will_show_as_the_organiser')}
          disabled={busy}
          onPress={onIllOrganise}
        />
        <Choice
          title={t('thresholdRole', 'ask_for_a_volunteer')}
          body={t('thresholdRole', 'everyone_whos_keen_sees_a_one_tap')}
          disabled={busy}
          onPress={onAskForAVolunteer}
        />
        {problem === undefined ? null : <Small accessibilityLiveRegion="polite">{problem}</Small>}
      </Body>
      <Foot>
        <Small>{t('thresholdRole', 'if_nobody_volunteers_before_replies_close_the')}</Small>
      </Foot>
    </Screen>
  );
}

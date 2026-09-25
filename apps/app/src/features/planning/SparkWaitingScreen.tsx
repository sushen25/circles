import type { ReactNode } from 'react';

import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Foot,
  Label,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * SparkWaiting — `docs/design/SparkWaiting.dc.html` (spec §5.4.3): the person
 * who asked, while it asks. When it closes and what opens it, **and no
 * count** — not even for them.
 *
 * Reached only on a view with `mayWithdraw`, which is true on the initiator's
 * own screen and nobody else's (`quietScreenOf`).
 */
export type SparkWaitingProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  /** "We're checking who's keen for a catch-up this weekend." */
  headline?: string | undefined;
  /** "Fri 11 Sep, 12 pm". */
  closes?: string | undefined;
  /** "3 of 6 are keen" — the threshold, from the view. */
  opensWhen?: string | undefined;
  backLabel?: string | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onBackToSundayCrew?: (() => void) | undefined;
  onWithdrawTheAsk?: (() => void) | undefined;
  /** The withdraw sheet, when it is open. */
  sheet?: ReactNode;
};

export function SparkWaitingScreen({
  circleName = t('sparkWaiting', 'sunday_crew'),
  headline = t('sparkWaiting', 'were_checking_whos_keen_for_this_weekend'),
  closes = t('sparkWaiting', 'fri_11_sep_12_pm'),
  opensWhen = t('sparkWaiting', '3_of_6_are_keen'),
  backLabel = t('sparkWaiting', 'back_to_sunday_crew'),
  onBack,
  onBackToSundayCrew,
  onWithdrawTheAsk,
  sheet,
}: SparkWaitingProps) {
  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('sparkWaiting', 'asked_quietly')}</Label>
          <DisplayXL>{headline}</DisplayXL>
          <BodyText>{t('sparkWaiting', 'well_tell_you_if_enough_people_say')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Small>{t('sparkWaiting', 'closes')}</Small>
            <Title>{closes}</Title>
          </Row>
          <Divider />
          <Row>
            <Small>{t('sparkWaiting', 'opens_up_when')}</Small>
            <Title>{opensWhen}</Title>
          </Row>
        </Card>
        <Small>{t('sparkWaiting', 'changed_your_mind_you_can_withdraw_it')}</Small>
      </Body>
      <Foot>
        <Button label={backLabel} variant="secondary" onPress={onBackToSundayCrew} />
        <Tertiary label={t('sparkWaiting', 'withdraw_the_ask')} onPress={onWithdrawTheAsk} />
      </Foot>
      {sheet}
    </Screen>
  );
}

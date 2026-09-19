import type { ResponseStatus } from '@circles/domain';
import { Pressable } from 'react-native';

import {
  Body,
  BodyText,
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
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * NoneWork — `docs/design/NoneWork.dc.html` (spec §5.5).
 *
 * Three answers, not a decline: somebody who wants to come but cannot this
 * fortnight is saying something different from somebody who is out, and "not
 * enough notice" is the one the organiser can do something about next time.
 * Tapping a card sends it — each is an answer, and a second confirm would be a
 * second decision on a screen that exists to make one (manifesto §3.6).
 */
export type NoneWorkStatus = Extract<ResponseStatus, 'none_work' | 'more_notice' | 'not_this_time'>;

export type NoneWorkProps = {
  title?: string | undefined;
  /** Who sees "keen", when there is an organiser to name. */
  organiserName?: string | null | undefined;
  /** The answer on its way, when one is. */
  sending?: NoneWorkStatus | undefined;
  problem?: string | undefined;
  reference?: string | undefined;
  onChoose?: ((status: NoneWorkStatus) => void) | undefined;
  onBackToMyTimes?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function NoneWorkScreen({
  title,
  organiserName = null,
  sending,
  problem,
  reference,
  onChoose,
  onBackToMyTimes,
  onBack,
}: NoneWorkProps) {
  const options: { status: NoneWorkStatus; title: string; body: string }[] = [
    {
      status: 'none_work',
      title: t('noneWork', 'im_keen_just_not_these_dates'),
      body:
        organiserName === null
          ? t('noneWork', 'keen_body_no_organiser')
          : t('noneWork', 'keen_body', { name: organiserName }),
    },
    {
      status: 'more_notice',
      title: t('noneWork', 'not_enough_notice'),
      body: t('noneWork', 'same_as_above_and_well_remember_to'),
    },
    {
      status: 'not_this_time',
      title: t('noneWork', 'not_this_time'),
      body: t('noneWork', 'no_reason_needed_nobody_is_told_anything'),
    },
  ];

  return (
    <Screen>
      <TopBar title={title} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('noneWork', 'none_of_these_dates_work_for_you')}</DisplayL>
          <BodyText>{t('noneWork', 'thats_useful_to_know_which_is_closer')}</BodyText>
        </Stack>
        {options.map((option, index) => (
          <Pressable
            key={option.status}
            role="button"
            aria-label={option.title}
            aria-busy={sending === option.status}
            disabled={sending !== undefined}
            onPress={() => onChoose?.(option.status)}
          >
            <Card recommended={index === 0}>
              <Row>
                <Title>{sending === option.status ? t('noneWork', 'sending') : option.title}</Title>
              </Row>
              <BodyText>{option.body}</BodyText>
            </Card>
          </Pressable>
        ))}
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('availability', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Tertiary label={t('noneWork', 'back_to_my_times')} onPress={onBackToMyTimes} />
      </Foot>
    </Screen>
  );
}

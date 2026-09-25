import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Marks,
  Screen,
  Small,
  Tertiary,
  TopBar,
  type Member,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * InterestPrompt — `docs/design/InterestPrompt.dc.html` (spec §5.4.2): the
 * aggregate prompt, to everybody but the person who asked.
 *
 * **Answered shows that they answered, never what.** The view has no
 * `myAnswer` (SUS-49): a phone read over a shoulder would say "keen" to
 * whoever was reading it. Changing an answer before the ask opens is offering
 * both buttons again, which needs no record of which one was pressed.
 */
export type InterestPromptProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  /** "Someone in Sunday Crew would be up for a catch-up this weekend. Would you?" */
  question?: string | undefined;
  members?: readonly Member[] | undefined;
  /** "Closes Fri 11 Sep, 12 pm. If it goes quiet, nobody is told." */
  closes?: string | undefined;
  /** They have answered, and are not changing it: the neutral thanks. */
  answered?: boolean | undefined;
  busy?: boolean | undefined;
  problem?: string | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onNotThisTime?: (() => void) | undefined;
  onChangeMyAnswer?: (() => void) | undefined;
};

export function InterestPromptScreen({
  fixture,
  circleName = t('interestPrompt', 'sunday_crew'),
  question = t('interestPrompt', 'someone_would_be_up_for_a_catch'),
  members = fixture?.circle.members ?? [],
  closes = t('interestPrompt', 'closes_friday_midday_if_it_goes_quiet'),
  answered = false,
  busy = false,
  problem,
  onNext,
  onBack,
  onNotThisTime,
  onChangeMyAnswer,
}: InterestPromptProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{circleName}</Label>
          {answered ? (
            <>
              <DisplayXL>{t('interestPrompt', 'thanks')}</DisplayXL>
              <BodyText>{t('interestPrompt', 'thanks_body')}</BodyText>
            </>
          ) : (
            <>
              <DisplayXL>{question}</DisplayXL>
              <BodyText>
                {t('interestPrompt', 'your_answer_stays_private_unless_enough_people')}
              </BodyText>
            </>
          )}
        </Stack>
        <Row>
          <Marks members={members} />
          <Small>{t('interestPrompt', 'asked_the_whole_circle')}</Small>
        </Row>
        {problem === undefined ? null : <Small accessibilityLiveRegion="polite">{problem}</Small>}
      </Body>
      <Foot>
        {answered ? (
          <Tertiary label={t('interestPrompt', 'change_my_answer')} onPress={onChangeMyAnswer} />
        ) : (
          <>
            <Button
              label={busy ? t('interestPrompt', 'sending') : t('interestPrompt', 'im_keen')}
              disabled={busy}
              onPress={onNext}
            />
            <Button
              label={t('interestPrompt', 'not_this_time')}
              variant="secondary"
              disabled={busy}
              onPress={onNotThisTime}
            />
          </>
        )}
        <Small>{closes}</Small>
      </Foot>
    </Screen>
  );
}

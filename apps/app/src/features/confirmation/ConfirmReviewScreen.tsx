import {
  Body,
  BodyText,
  Button,
  Chip,
  Chips,
  DateText,
  Foot,
  Input,
  Label,
  Marks,
  Notice,
  Screen,
  Small,
  TopBar,
  type Member,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ChasedAnswer } from '../../data/confirmation';
import { MARKS_MAX, Placeholder } from '../scheduling/parts';
import { NOTE_MAX_LENGTH, PLACE_NAME_MAX_LENGTH, PLACE_URL_MAX_LENGTH } from './review';

/**
 * ConfirmReview — `docs/design/ConfirmReview.dc.html` (spec §5.7, §5.10).
 *
 * The last look before a time is frozen: the option as the card described it,
 * where and a note, who has not replied, and the one survey question §5.10
 * asks here — three chips above the primary, because `confirm-meetup` refuses
 * a confirmation without an answer and `none` is one.
 *
 * Presentational. Every string arrives worked out (`review.ts`); the flow owns
 * the reading, the freshness check and the call.
 */
export type ConfirmReviewState = 'default' | 'loading' | 'error' | 'offline' | 'denied' | 'expired';

export type ConfirmReviewProps = {
  state?: ConfirmReviewState | undefined;
  date?: string | undefined;
  time?: string | undefined;
  members?: readonly Member[] | undefined;
  membersLabel?: string | undefined;
  summary?: string | undefined;
  zoneNote?: string | undefined;
  warning?: string | undefined;
  placeName?: string | undefined;
  placeUrl?: string | undefined;
  placeUrlError?: string | undefined;
  note?: string | undefined;
  noteCount?: string | undefined;
  chased?: ChasedAnswer | undefined;
  /** A change under the screen, or a refusal, said in words. */
  notice?: string | undefined;
  /** The set is behind the plan: nothing is locked in until it is not. */
  waiting?: boolean | undefined;
  busy?: boolean | undefined;
  canLockIn?: boolean | undefined;
  /** For `denied` and `expired`: what to say. */
  message?: string | undefined;
  detail?: string | undefined;
  onPlaceName?: ((value: string) => void) | undefined;
  onPlaceUrl?: ((value: string) => void) | undefined;
  onNote?: ((value: string) => void) | undefined;
  onChase?: ((answer: ChasedAnswer) => void) | undefined;
  onLockIn?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

const CHASE: readonly { answer: ChasedAnswer; key: 'chase_none' | 'chase_one' | 'chase_more' }[] = [
  { answer: 'none', key: 'chase_none' },
  { answer: 'one', key: 'chase_one' },
  { answer: 'more', key: 'chase_more' },
];

export function ConfirmReviewScreen({
  state = 'default',
  date,
  time,
  members = [],
  membersLabel,
  summary,
  zoneNote,
  warning,
  placeName = '',
  placeUrl = '',
  placeUrlError,
  note = '',
  noteCount,
  chased,
  notice,
  waiting = false,
  busy = false,
  canLockIn = false,
  message,
  detail,
  onPlaceName,
  onPlaceUrl,
  onNote,
  onChase,
  onLockIn,
  onRetry,
  onBack,
}: ConfirmReviewProps) {
  const back = t('confirmReview', 'back_to_options');
  if (state === 'loading') {
    return <Placeholder topTitle={back} message={t('confirmReview', 'loading')} onBack={onBack} />;
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Placeholder
        topTitle={back}
        message={
          state === 'offline'
            ? t('confirmReview', 'youre_offline')
            : t('confirmReview', 'couldnt_load')
        }
        actionLabel={t('confirmReview', 'try_again')}
        onAction={onRetry}
        onBack={onBack}
      />
    );
  }
  if (state === 'denied' || state === 'expired') {
    return (
      <Placeholder
        topTitle={back}
        message={message ?? t('confirmReview', 'gone_title')}
        detail={detail}
        actionLabel={back}
        onAction={onBack}
        onBack={onBack}
      />
    );
  }

  return (
    <Screen>
      <TopBar title={back} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('confirmReview', 'lock_it_in')}</Label>
          <DateText>{date}</DateText>
          <BodyText>{time}</BodyText>
          {zoneNote === undefined ? null : <Small>{zoneNote}</Small>}
        </Stack>
        <Stack gap={8}>
          <Row>
            <Marks members={members} max={MARKS_MAX} label={membersLabel} />
          </Row>
          <Small>{summary}</Small>
        </Stack>
        {waiting ? <Notice icon="clock">{t('confirmReview', 'updating')}</Notice> : null}
        {notice === undefined ? null : <Notice kind="warn">{notice}</Notice>}
        <Stack>
          <Label>{t('confirmReview', 'where')}</Label>
          <Input
            aria-label={t('confirmReview', 'place_name_label')}
            placeholder={t('confirmReview', 'place_name')}
            value={placeName}
            maxLength={PLACE_NAME_MAX_LENGTH}
            onChangeText={onPlaceName}
          />
          <Input
            aria-label={t('confirmReview', 'place_url_label')}
            placeholder={t('confirmReview', 'place_url')}
            value={placeUrl}
            maxLength={PLACE_URL_MAX_LENGTH}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onPlaceUrl}
          />
          {placeUrlError === undefined ? null : (
            <Small accessibilityLiveRegion="polite">{placeUrlError}</Small>
          )}
        </Stack>
        <Stack>
          <Label>{t('confirmReview', 'a_note_for_everyone')}</Label>
          <Input
            aria-label={t('confirmReview', 'a_note_for_everyone')}
            placeholder={t('confirmReview', 'note_placeholder')}
            value={note}
            maxLength={NOTE_MAX_LENGTH}
            multiline
            onChangeText={onNote}
          />
          <Small>{noteCount}</Small>
        </Stack>
        {warning === undefined ? null : <Notice kind="warn">{warning}</Notice>}
        <Stack gap={10}>
          <BodyText>{t('confirmReview', 'chase_question')}</BodyText>
          <Chips>
            {CHASE.map(({ answer, key }) => (
              <Chip
                key={answer}
                label={t('confirmReview', key)}
                selected={chased === answer}
                onPress={onChase === undefined ? undefined : () => onChase(answer)}
              />
            ))}
          </Chips>
          <Small>{t('confirmReview', 'chase_hint')}</Small>
        </Stack>
      </Body>
      <Foot>
        <Button
          label={busy ? t('confirmReview', 'locking') : t('confirmReview', 'lock_it_in_2')}
          onPress={onLockIn}
          disabled={!canLockIn || busy || waiting}
        />
        <Small>{t('confirmReview', 'times_are_frozen_once_locked_later_replies')}</Small>
      </Foot>
    </Screen>
  );
}

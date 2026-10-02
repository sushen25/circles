import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Input,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Between, Stack } from '../../components/layout';
import { t } from '../../copy';
import { Placeholder } from '../scheduling/parts';
import { NOTE_MAX_LENGTH, PLACE_NAME_MAX_LENGTH, PLACE_URL_MAX_LENGTH } from './review';

/**
 * EditLocked — `docs/design/EditLocked.dc.html` (spec §5.7, ADR 0050).
 *
 * "Edit this plan" on a locked-in plan: when (with a Change that opens the same
 * time picker), where, and the note. Changing only the place or note says a new
 * one shows for everyone straight away and nobody has to answer again; moving
 * the time says who it still works for and who is asked whether they can come.
 * The primary is "Save changes"; the tertiary is "Keep Friday as it is".
 *
 * Presentational. The words arrive worked out (`editLocked.ts`); the flow owns
 * the reading, the picker round trip and the save.
 */
export type EditLockedState = 'default' | 'loading' | 'error' | 'offline' | 'denied' | 'expired';

export type EditLockedProps = {
  state?: EditLockedState | undefined;
  /** "Fri 18 Sep" and "7–9 pm": the time the plan will have once saved. */
  date?: string | undefined;
  time?: string | undefined;
  /** Who a moved time works for, said under When once the time has moved. */
  whoLine?: string | undefined;
  placeName?: string | undefined;
  placeUrl?: string | undefined;
  placeUrlError?: string | undefined;
  note?: string | undefined;
  noteCount?: string | undefined;
  /** What saving does, in words: one for a place or note, another for a move. */
  notice?: string | undefined;
  moved?: boolean | undefined;
  /** "Keep Friday as it is". */
  keepLabel?: string | undefined;
  /** A refusal, or a change under the screen, said in words. */
  problem?: string | undefined;
  busy?: boolean | undefined;
  canSave?: boolean | undefined;
  onChangeTime?: (() => void) | undefined;
  onPlaceName?: ((value: string) => void) | undefined;
  onPlaceUrl?: ((value: string) => void) | undefined;
  onNote?: ((value: string) => void) | undefined;
  onSave?: (() => void) | undefined;
  onKeep?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function EditLockedScreen({
  state = 'default',
  date,
  time,
  whoLine,
  placeName = '',
  placeUrl = '',
  placeUrlError,
  note = '',
  noteCount,
  notice,
  moved = false,
  keepLabel,
  problem,
  busy = false,
  canSave = false,
  onChangeTime,
  onPlaceName,
  onPlaceUrl,
  onNote,
  onSave,
  onKeep,
  onRetry,
  onBack,
}: EditLockedProps) {
  const back = t('editLocked', 'back_to_plan');
  if (state === 'loading') {
    return <Placeholder topTitle={back} message={t('editLocked', 'loading')} onBack={onBack} />;
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Placeholder
        topTitle={back}
        message={
          state === 'offline' ? t('editLocked', 'youre_offline') : t('editLocked', 'couldnt_load')
        }
        actionLabel={t('editLocked', 'try_again')}
        onAction={onRetry}
        onBack={onBack}
      />
    );
  }
  if (state === 'denied' || state === 'expired') {
    return (
      <Placeholder
        topTitle={back}
        message={t('editLocked', state === 'denied' ? 'denied_title' : 'over_title')}
        detail={t('editLocked', state === 'denied' ? 'denied_body' : 'over_body')}
        actionLabel={t('editLocked', 'go_to_plan')}
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
          <DisplayL>{t('editLocked', 'headline')}</DisplayL>
          <BodyText>{t('editLocked', 'lead')}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('editLocked', 'when')}</Label>
          <Between>
            <Stack>
              <Title>{date}</Title>
              <Small>{time}</Small>
            </Stack>
            <Tertiary
              label={t('editLocked', 'change')}
              accessibilityHint={t('editLocked', 'change_label')}
              onPress={onChangeTime}
            />
          </Between>
          {moved && whoLine !== undefined ? (
            <Small accessibilityLiveRegion="polite">{whoLine}</Small>
          ) : null}
        </Stack>
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
        {notice === undefined ? null : <Notice kind={moved ? 'warn' : 'plain'}>{notice}</Notice>}
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
      </Body>
      <Foot>
        <Button
          label={busy ? t('editLocked', 'saving') : t('editLocked', 'save')}
          onPress={onSave}
          disabled={!canSave || busy}
        />
        <Tertiary label={keepLabel ?? t('editLocked', 'keep_plain')} onPress={onKeep} />
      </Foot>
    </Screen>
  );
}

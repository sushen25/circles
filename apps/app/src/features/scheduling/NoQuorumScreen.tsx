import { Fragment } from 'react';
import { Pressable } from 'react-native';

import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Label,
  Notice,
  Screen,
  Sheet,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import { CandidateCard, CandidateHeader, Placeholder } from './parts';
import type { Unlock } from './unlock';
import type { CardView, HeaderView } from './view';

/**
 * NoQuorum — `docs/design/NoQuorum.dc.html` (spec §5.6).
 *
 * The closest it got, the one rule that blocked it, and what would unlock it.
 * The whole screen is written to §3.5: a plan that fails names nobody and
 * nothing here reads as the group letting anyone down.
 *
 * Each row is its own decision and takes one tap, the way NoneWork's answers
 * do — with one exception. Closing the attempt cannot be undone, so it asks,
 * in the words that say exactly what everybody will be told.
 */
export type NoQuorumState = 'default' | 'loading' | 'error' | 'offline' | 'denied';

export type NoQuorumProps = {
  state?: NoQuorumState | undefined;
  header?: HeaderView | undefined;
  headline?: string | undefined;
  /** The one rule: "Nothing in the window works for at least 4 of you." */
  blocked?: string | undefined;
  nearMisses?: readonly CardView[] | undefined;
  unlocks?: readonly Unlock[] | undefined;
  /**
   * The set on screen is behind the plan, so nothing here is decided from it.
   *
   * Lowering the quorum is permanent and the number comes from a near-miss;
   * "change who has to be there" names a blocker the newest answer may have
   * cleared. Both wait for the recalculation the notice is about.
   */
  stale?: boolean | undefined;
  /** An action on its way. */
  busy?: 'lower' | 'close' | 'wider' | 'extend' | undefined;
  /** Which sheet is open, when one is. */
  asking?: 'close' | 'wider' | undefined;
  /** "The plan would run to Sunday. …" — the cost of a wider window. */
  widerWarning?: string | undefined;
  problem?: string | undefined;
  onUnlock?: ((unlock: Unlock) => void) | undefined;
  onConfirmClose?: (() => void) | undefined;
  onConfirmWiden?: (() => void) | undefined;
  onKeepAsItIs?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function NoQuorumScreen({
  state = 'default',
  header,
  headline,
  blocked,
  nearMisses = [],
  unlocks = [],
  stale = false,
  busy,
  asking,
  widerWarning,
  problem,
  onUnlock,
  onConfirmClose,
  onConfirmWiden,
  onKeepAsItIs,
  onRetry,
  onBack,
}: NoQuorumProps) {
  if (state === 'loading') {
    return <Placeholder message={t('noQuorum', 'loading')} onBack={onBack} />;
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Placeholder
        message={
          state === 'offline' ? t('noQuorum', 'youre_offline') : t('noQuorum', 'couldnt_load')
        }
        actionLabel={t('noQuorum', 'try_again')}
        onAction={onRetry}
        onBack={onBack}
      />
    );
  }
  if (state === 'denied') {
    return (
      <Placeholder
        message={t('noQuorum', 'denied_title')}
        detail={t('noQuorum', 'denied_body')}
        onBack={onBack}
      />
    );
  }

  return (
    <Screen>
      <TopBar title={header?.title} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        {header === undefined ? null : <CandidateHeader header={header} />}
        <Stack>
          <DisplayL>{headline ?? t('noQuorum', 'headline')}</DisplayL>
          {blocked === undefined ? null : <BodyText>{blocked}</BodyText>}
        </Stack>
        {stale ? <Notice icon="clock">{t('candidates', 'updating')}</Notice> : null}
        {nearMisses.map((card) => (
          <CandidateCard key={card.id} card={card} highlighted={false} />
        ))}
        <Label>{t('noQuorum', 'what_would_unlock_it')}</Label>
        <Card>
          {unlocks.map((unlock, index) => (
            <Fragment key={unlock.kind}>
              {index === 0 ? null : <Divider />}
              <Pressable
                role="button"
                // Both halves: an explicit label replaces the name a reader
                // would build from the row, and the body is where "the plan
                // then keeps 3 as its number" is said.
                aria-label={`${unlock.title}. ${unlock.body}`}
                aria-busy={busy === unlock.kind}
                aria-disabled={stale || busy !== undefined}
                disabled={stale || busy !== undefined}
                onPress={() => onUnlock?.(unlock)}
              >
                <Stack>
                  <Title>{busy === unlock.kind ? busyWord(unlock.kind) : unlock.title}</Title>
                  <Small>{unlock.body}</Small>
                </Stack>
              </Pressable>
            </Fragment>
          ))}
        </Card>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
      </Body>
      <Sheet
        visible={asking === 'close'}
        onDismiss={() => onKeepAsItIs?.()}
        label={t('noQuorum', 'sheet_label')}
        dismissLabel={t('noQuorum', 'dismiss_label')}
      >
        <Stack>
          <Title>{t('noQuorum', 'confirm_title')}</Title>
          <BodyText>{t('noQuorum', 'confirm_body')}</BodyText>
        </Stack>
        <Button
          label={busy === 'close' ? t('noQuorum', 'closing') : t('noQuorum', 'confirm_close')}
          variant="secondary"
          disabled={busy === 'close'}
          onPress={onConfirmClose}
        />
        <Tertiary label={t('noQuorum', 'keep_open')} onPress={onKeepAsItIs} />
      </Sheet>
      <Sheet
        visible={asking === 'wider'}
        onDismiss={() => onKeepAsItIs?.()}
        label={t('noQuorum', 'wider_sheet_label')}
        dismissLabel={t('noQuorum', 'wider_keep')}
      >
        <Stack>
          <Title>{t('noQuorum', 'wider_confirm_title')}</Title>
          {widerWarning === undefined ? null : <BodyText>{widerWarning}</BodyText>}
        </Stack>
        <Button
          label={busy === 'wider' ? t('noQuorum', 'widening') : t('noQuorum', 'wider_confirm')}
          variant="secondary"
          disabled={busy === 'wider'}
          onPress={onConfirmWiden}
        />
        <Tertiary label={t('noQuorum', 'wider_keep')} onPress={onKeepAsItIs} />
      </Sheet>
    </Screen>
  );
}

function busyWord(kind: Unlock['kind']): string {
  if (kind === 'close') return t('noQuorum', 'closing');
  if (kind === 'wider') return t('noQuorum', 'checking');
  if (kind === 'extend') return t('deadlinePassed', 'extending');
  return t('noQuorum', 'lowering');
}

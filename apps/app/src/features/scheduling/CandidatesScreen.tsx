import { useState } from 'react';
import { View } from 'react-native';

import {
  Body,
  BodyText,
  Button,
  CompactButton,
  DisplayL,
  Foot,
  Loading,
  Notice,
  Screen,
  Small,
  TopBar,
  useLoadingHold,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { CandidateCard, CandidateHeader, Placeholder, SetTimeRow } from './parts';
import type { CardView, HeaderView } from './view';

/**
 * Candidates — `docs/design/Candidates.dc.html` (spec §5.6), the organiser's.
 *
 * The product's argument, made once: at most three explained options, names
 * rather than counts where a count would sting, and a human decides. Every
 * card says who is coming, who is not, who has not answered and why it ranks
 * where it does, without a tap (manifesto §3.4).
 *
 * Presentational — every string arrives worked out from `view.ts`. Selecting a
 * card moves the accent border and the button's day; nothing is confirmed here
 * (S1-28 owns the review), so the primary is "Review <weekday>".
 */
export type CandidatesState = 'default' | 'loading' | 'error' | 'offline' | 'denied' | 'expired';

export type CandidatesProps = {
  state?: CandidatesState | undefined;
  header?: HeaderView | undefined;
  headline?: string | undefined;
  lead?: string | undefined;
  cards?: readonly CardView[] | undefined;
  /** The one about to be reviewed. */
  selectedId?: string | undefined;
  /** "Review Thursday". */
  reviewLabel?: string | undefined;
  /** "Nudge Alex" — absent once everybody has answered. */
  nudgeLabel?: string | undefined;
  /** The stored set is behind the plan, so nothing is reviewed until it is not. */
  stale?: boolean | undefined;
  problem?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  /** "Pick a different time": any day and time, not only an option (ADR 0051). */
  onSetTime?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  onNudge?: (() => void) | undefined;
  /** The plan's link again, while replies are open (SUS-132). */
  onShareAgain?: (() => void) | undefined;
  /** What sharing did when it copied rather than opened a sheet. */
  shareOutcome?: string | undefined;
  /** The organiser changes the plan while it is still asking (S1-26). */
  onEditPlan?: (() => void) | undefined;
  /** The organiser's own answer, opened as a member's is (SUS-158). */
  onChangeMyTimes?: (() => void) | undefined;
  /** Replies have closed: "Change my times" is shown disabled, with why. */
  repliesClosed?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CandidatesScreen({
  state = 'default',
  header,
  headline,
  lead,
  cards = [],
  selectedId,
  reviewLabel,
  nudgeLabel,
  stale = false,
  problem,
  onSelect,
  onSetTime,
  onNext,
  onNudge,
  onShareAgain,
  shareOutcome,
  onEditPlan,
  onChangeMyTimes,
  repliesClosed = false,
  onRetry,
  onBack,
}: CandidatesProps) {
  // What a share said belongs beside the button that asked: the header's, or
  // the footer's nudge, which stays on screen while the header has scrolled away.
  const [fromNudge, setFromNudge] = useState(false);
  const loading = useLoadingHold(state === 'loading');
  if (loading) {
    return (
      <Loading
        message={t('candidates', 'loading')}
        shape="cards"
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Placeholder
        message={
          state === 'offline' ? t('candidates', 'youre_offline') : t('candidates', 'couldnt_load')
        }
        actionLabel={t('candidates', 'try_again')}
        onAction={onRetry}
        onBack={onBack}
      />
    );
  }
  if (state === 'denied') {
    return (
      <Placeholder
        message={t('candidates', 'denied_title')}
        detail={t('candidates', 'denied_body')}
        onBack={onBack}
      />
    );
  }
  if (state === 'expired') {
    return (
      <Placeholder
        topTitle={header?.title}
        message={t('candidates', 'closed_title')}
        detail={t('candidates', 'closed_body')}
        onBack={onBack}
      />
    );
  }

  return (
    <Screen>
      <TopBar title={header?.title} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        {header === undefined ? null : (
          <CandidateHeader
            header={header}
            onShareAgain={
              onShareAgain === undefined
                ? undefined
                : () => {
                    setFromNudge(false);
                    onShareAgain();
                  }
            }
            shareOutcome={fromNudge ? undefined : shareOutcome}
            onEditPlan={onEditPlan}
            onChangeMyTimes={onChangeMyTimes}
            repliesClosed={repliesClosed}
          />
        )}
        <Stack>
          {headline === undefined ? null : <DisplayL>{headline}</DisplayL>}
          {lead === undefined ? null : <BodyText>{lead}</BodyText>}
        </Stack>
        {stale ? <Notice icon="clock">{t('candidates', 'updating')}</Notice> : null}
        {cards.map((card) => (
          <CandidateCard
            key={card.id}
            card={card}
            highlighted={selectedId === undefined ? card.recommended : card.id === selectedId}
            selected={card.id === selectedId}
            onPress={onSelect === undefined ? undefined : () => onSelect(card.id)}
          />
        ))}
        {onSetTime === undefined ? null : (
          <SetTimeRow
            title={t('candidates', 'different_time_title')}
            detail={t('candidates', 'different_time_body')}
            onPress={onSetTime}
          />
        )}
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
      </Body>
      <Foot>
        {reviewLabel === undefined ? null : (
          <Button label={reviewLabel} onPress={onNext} disabled={stale} />
        )}
        {nudgeLabel === undefined ? null : (
          <View style={{ alignSelf: 'center' }}>
            <CompactButton
              label={nudgeLabel}
              onPress={() => {
                setFromNudge(true);
                onNudge?.();
              }}
            />
          </View>
        )}
        {fromNudge && shareOutcome !== undefined ? (
          <Small accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>
            {shareOutcome}
          </Small>
        ) : null}
      </Foot>
    </Screen>
  );
}

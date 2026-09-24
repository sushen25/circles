import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { CandidateCard, CandidateHeader, Placeholder } from './parts';
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
  onNext?: (() => void) | undefined;
  onNudge?: (() => void) | undefined;
  /** The organiser changes the plan while it is still asking (S1-26). */
  onEditPlan?: (() => void) | undefined;
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
  onNext,
  onNudge,
  onEditPlan,
  onRetry,
  onBack,
}: CandidatesProps) {
  if (state === 'loading') {
    return <Placeholder message={t('candidates', 'loading')} onBack={onBack} />;
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
        {header === undefined ? null : <CandidateHeader header={header} />}
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
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
      </Body>
      <Foot>
        {reviewLabel === undefined ? null : (
          <Button label={reviewLabel} onPress={onNext} disabled={stale} />
        )}
        {nudgeLabel === undefined ? null : <Tertiary label={nudgeLabel} onPress={onNudge} />}
        {onEditPlan === undefined ? null : (
          <Tertiary label={t('waiting', 'edit_the_plan')} onPress={onEditPlan} />
        )}
      </Foot>
    </Screen>
  );
}

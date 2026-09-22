import { Body, BodyText, Button, DisplayL, Foot, Screen, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { CandidateCard, CandidateHeader, Placeholder } from './parts';
import type { CardView, HeaderView } from './view';

/**
 * CandidatesMember — `docs/design/CandidatesMember.dc.html` (spec §5.6).
 *
 * The same options, with nothing to decide: "all active members see the
 * candidates before confirmation; only the organiser can confirm". So there is
 * no primary here — the one thing a member can still do is change their own
 * times, and it is the only button on the screen.
 *
 * **It is absent once replies have closed.** A plan stays `collecting` or
 * `ready` past its deadline so the organiser can decide (spec §8), but
 * `replace_response` refuses an answer then (`replies_closed`), so offering the
 * editor would send somebody to a screen they cannot send from.
 *
 * With no options yet, this is where the spec's "members see nothing until
 * options exist" lands, and §3.5 decides how it reads: waiting for people,
 * never a group that has failed. No near-misses and no resolution actions —
 * those are the organiser's screen.
 */
export type CandidatesMemberState =
  'default' | 'waiting' | 'no_overlap' | 'loading' | 'error' | 'offline' | 'denied' | 'expired';

export type CandidatesMemberProps = {
  state?: CandidatesMemberState | undefined;
  header?: HeaderView | undefined;
  headline?: string | undefined;
  lead?: string | undefined;
  cards?: readonly CardView[] | undefined;
  onChangeMyTimes?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CandidatesMemberScreen({
  state = 'default',
  header,
  headline,
  lead,
  cards = [],
  onChangeMyTimes,
  onRetry,
  onBack,
}: CandidatesMemberProps) {
  if (state === 'loading') {
    return <Placeholder message={t('candidatesMember', 'loading')} onBack={onBack} />;
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Placeholder
        message={
          state === 'offline'
            ? t('candidatesMember', 'youre_offline')
            : t('candidatesMember', 'couldnt_load')
        }
        actionLabel={t('candidatesMember', 'try_again')}
        onAction={onRetry}
        onBack={onBack}
      />
    );
  }
  if (state === 'denied') {
    return (
      <Placeholder
        message={t('candidatesMember', 'denied_title')}
        detail={t('candidatesMember', 'denied_body')}
        onBack={onBack}
      />
    );
  }
  if (state === 'expired') {
    return (
      <Placeholder
        topTitle={header?.title}
        message={t('candidatesMember', 'closed_title')}
        detail={t('candidatesMember', 'closed_body')}
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
        {cards.map((card) => (
          <CandidateCard key={card.id} card={card} highlighted={card.recommended} />
        ))}
      </Body>
      {onChangeMyTimes === undefined ? null : (
        <Foot>
          <Button
            label={t('candidatesMember', 'change_my_times')}
            variant="secondary"
            onPress={onChangeMyTimes}
          />
        </Foot>
      )}
    </Screen>
  );
}

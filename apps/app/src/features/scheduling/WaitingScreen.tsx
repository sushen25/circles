import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Label,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { CandidateHeader, Placeholder } from './parts';
import type { HeaderView } from './view';

/**
 * Waiting — `docs/design/Waiting.dc.html` (spec §5.6): "before any candidate
 * exists the organiser sees a waiting state with what has come in".
 *
 * **What has come in is counts and names, never times.** A member's windows are
 * readable by that member alone, and `response_summaries` carries who answered
 * and with what status and deliberately no window (migration 0004) — so the
 * artboard's per-day totals are not a thing any client can compute. What is
 * true and useful is here instead: how many have answered, who is still to,
 * and what has to happen for options to appear.
 *
 * A plan sitting below its quorum early on is not an error (ADR 0026: a circle
 * of one starts at three), so this reads as waiting for people rather than as
 * something going wrong.
 */
export type WaitingState = 'default' | 'loading' | 'error' | 'offline' | 'denied';

export type WaitingProps = {
  state?: WaitingState | undefined;
  header?: HeaderView | undefined;
  headline?: string | undefined;
  body?: string | undefined;
  /** "4 of 6 have answered." */
  answered?: string | undefined;
  /** "Still to answer: Alex and Tom." */
  still?: string | undefined;
  onShareAgain?: (() => void) | undefined;
  onEditPlan?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function WaitingScreen({
  state = 'default',
  header,
  headline,
  body,
  answered,
  still,
  onShareAgain,
  onEditPlan,
  onRetry,
  onBack,
}: WaitingProps) {
  if (state === 'loading') {
    return <Placeholder message={t('waiting', 'loading')} onBack={onBack} />;
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Placeholder
        message={state === 'offline' ? t('waiting', 'youre_offline') : t('waiting', 'couldnt_load')}
        actionLabel={t('waiting', 'try_again')}
        onAction={onRetry}
        onBack={onBack}
      />
    );
  }
  if (state === 'denied') {
    return (
      <Placeholder
        message={t('waiting', 'denied_title')}
        detail={t('waiting', 'denied_body')}
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
          <DisplayL>{headline ?? t('waiting', 'headline')}</DisplayL>
          {body === undefined ? null : <BodyText>{body}</BodyText>}
        </Stack>
        <Card>
          <Label>{t('waiting', 'so_far')}</Label>
          <Stack>
            {answered === undefined ? null : <Title>{answered}</Title>}
            {still === undefined ? null : <BodyText>{still}</BodyText>}
          </Stack>
        </Card>
        <Small>{t('waiting', 'only_you')}</Small>
      </Body>
      <Foot>
        <Button
          label={t('waiting', 'share_the_link_again')}
          variant="secondary"
          onPress={onShareAgain}
        />
        <Tertiary label={t('waiting', 'edit_the_plan')} onPress={onEditPlan} />
      </Foot>
    </Screen>
  );
}

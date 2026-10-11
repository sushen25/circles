import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * NudgeStop — `docs/design/NudgeStop.dc.html` (ADR 0067).
 *
 * The page behind "Stop these reminders" in a cadence nudge. **It asks for one
 * tap and does nothing before it**: opening the link spends nothing, so a mail
 * gateway or a link scanner that loads the page stops no reminders. The tap
 * can be repeated without harm, and the page never says whose reminders or
 * which circle: the link is the whole of its authority and it reveals nothing.
 */
export type NudgeStopState =
  'default' | 'stopping' | 'done' | 'expired' | 'no_token' | 'error' | 'offline';

export type NudgeStopProps = {
  state?: NudgeStopState | undefined;
  reference?: string | undefined;
  onStop?: (() => void) | undefined;
};

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Screen>
      <TopBar />
      <Body>
        <Stack>
          <DisplayL>{title}</DisplayL>
          <BodyText>{body}</BodyText>
        </Stack>
      </Body>
    </Screen>
  );
}

export function NudgeStopScreen({ state = 'default', reference, onStop }: NudgeStopProps) {
  switch (state) {
    case 'done':
      return <Message title={t('nudgeStop', 'done')} body={t('nudgeStop', 'done_body')} />;
    case 'expired':
      return (
        <Message
          title={t('nudgeStop', 'link_expired')}
          body={t('nudgeStop', 'link_expired_body')}
        />
      );
    case 'no_token':
      return (
        <Message
          title={t('nudgeStop', 'open_it_again')}
          body={t('nudgeStop', 'open_it_again_body')}
        />
      );
    default:
      break;
  }

  const problem = state === 'error' || state === 'offline';
  return (
    <Screen>
      <TopBar />
      <Body>
        <Stack>
          <DisplayL>{t('nudgeStop', 'stop_these_reminders')}</DisplayL>
          <BodyText>{t('nudgeStop', 'body')}</BodyText>
        </Stack>
        {problem ? (
          <Notice kind="warn">
            {state === 'offline' ? t('nudgeStop', 'youre_offline') : t('nudgeStop', 'couldnt_stop')}
          </Notice>
        ) : null}
        {reference === undefined ? null : (
          <Small>{t('nudgeStop', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={t('nudgeStop', problem ? 'try_again' : 'stop_these_reminders')}
          busyLabel={t('nudgeStop', 'stopping')}
          busy={state === 'stopping'}
          onPress={onStop}
        />
      </Foot>
    </Screen>
  );
}

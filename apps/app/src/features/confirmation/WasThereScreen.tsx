import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { RetrospectiveAnswer } from '../../data/confirmation';
import type { MorningAfterWords } from './morningAfter';
import { MorningPlaceholder, type MorningState } from './morningParts';

/**
 * WasThere — `docs/design/WasThere.dc.html` (spec §5.10): "Did you make it to
 * Thursday's catch-up?", from circle home or the emailed link.
 *
 * Two answers and a way out, and **the same words back whichever it was**:
 * "Thanks, noted." A member who missed it is not thanked less, and nobody is
 * shown who else came — the counts `report-outcome` returns go to the funnel,
 * never to this screen (manifesto §3.5).
 *
 * `said` is an earlier answer, shown so a second visit is not a blank question;
 * either answer can still be changed to the other.
 *
 * Presentational. The flow owns the read, the write and where each goes.
 */
export type WasThereState = MorningState | 'not_asked' | 'done';

export type WasThereProps = {
  state?: WasThereState | undefined;
  words?: MorningAfterWords | undefined;
  said?: RetrospectiveAnswer | undefined;
  /** The answer on its way, whose button says so; both wait meanwhile. */
  saving?: RetrospectiveAnswer | undefined;
  notice?: string | undefined;
  /** The screen's one decision. */
  onWasThere?: (() => void) | undefined;
  onMissed?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onToCircle?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function WasThereScreen({
  state = 'default',
  words,
  said,
  saving,
  notice,
  onWasThere,
  onMissed,
  onNotNow,
  onRetry,
  onToCircle,
  onBack,
}: WasThereProps) {
  if ((state === 'done' || state === 'not_asked') && words !== undefined) {
    const done = state === 'done';
    return (
      <Screen>
        <TopBar title={words.circle} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Stack>
            <BodyText accessibilityLiveRegion="polite">
              {done ? t('wasThere', 'done_title') : t('wasThere', 'not_asked_title')}
            </BodyText>
            <Small>
              {done
                ? t('wasThere', 'done_body', { circle: words.circle })
                : t('wasThere', 'not_asked_body')}
            </Small>
          </Stack>
        </Body>
        {onToCircle === undefined ? null : (
          <Foot>
            <Button
              label={t('wasThere', 'back_to_circle', { circle: words.circle })}
              onPress={onToCircle}
            />
          </Foot>
        )}
      </Screen>
    );
  }
  if (state !== 'default' || words === undefined) {
    return (
      <MorningPlaceholder
        screen="wasThere"
        state={state === 'default' || state === 'done' || state === 'not_asked' ? 'loading' : state}
        words={words}
        onRetry={onRetry}
        onToCircle={onToCircle}
        onBack={onBack}
      />
    );
  }

  const busy = saving !== undefined;
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('wasThere', 'label', { circle: words.circle, date: words.date })}</Label>
          <DisplayXL>{t('wasThere', 'title', { day: words.day })}</DisplayXL>
          <BodyText>{t('wasThere', 'helps_the_group_keep_a_light_record')}</BodyText>
        </Stack>
        {said === undefined ? null : (
          <Stack>
            <BodyText>
              {said === 'was_there' ? t('wasThere', 'said_there') : t('wasThere', 'said_missed')}
            </BodyText>
            <Small>{t('wasThere', 'change_below')}</Small>
          </Stack>
        )}
        {notice === undefined ? null : <Notice kind="warn">{notice}</Notice>}
      </Body>
      <Foot>
        <Button
          label={saving === 'was_there' ? t('wasThere', 'saving') : t('wasThere', 'i_was_there')}
          disabled={busy}
          onPress={onWasThere}
        />
        <Button
          label={saving === 'missed' ? t('wasThere', 'saving') : t('wasThere', 'i_couldnt_make_it')}
          variant="secondary"
          disabled={busy}
          onPress={onMissed}
        />
        {onNotNow === undefined ? null : (
          <Tertiary label={t('wasThere', 'not_now')} disabled={busy} onPress={onNotNow} />
        )}
      </Foot>
    </Screen>
  );
}

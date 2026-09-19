import { Body, BodyText, Button, DisplayL, Foot, Notice, Screen, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * Offline — `docs/design/Offline.dc.html`: an answer that has not gone yet.
 *
 * Two of the artboard's states. **Offline**: the times are on this phone and
 * will go by themselves when the connection is back (manifesto §7.6, "edits
 * survive and resubmit"). **Error**: the server answered and it was not a yes,
 * so a reference to quote and a way to try again (§7.5). Neither loses what
 * was painted; the draft behind this screen is the same one the editor reads.
 */
export type OfflineKind = 'offline' | 'error';

export type OfflineProps = {
  kind?: OfflineKind | undefined;
  title?: string | undefined;
  /** When the draft was saved, as a time of day on this device. */
  savedAt?: string | undefined;
  reference?: string | undefined;
  /** Who to send the reference to. */
  organiserName?: string | null | undefined;
  busy?: boolean | undefined;
  onTryAgain?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function OfflineScreen({
  kind = 'offline',
  title,
  savedAt,
  reference,
  organiserName = null,
  busy = false,
  onTryAgain,
  onBack,
}: OfflineProps) {
  return (
    <Screen>
      <TopBar title={title} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        {kind === 'offline' ? (
          <>
            <Stack>
              <DisplayL>{t('offline', 'your_times_are_saved_on_this_phone')}</DisplayL>
              <BodyText>{t('offline', 'we_couldnt_reach_brand_just_now_well')}</BodyText>
            </Stack>
            {savedAt === undefined ? null : (
              <Notice>{t('offline', 'saved_at', { time: savedAt })}</Notice>
            )}
          </>
        ) : (
          <>
            <Stack>
              <DisplayL>{t('offline', 'something_didnt_save')}</DisplayL>
              <BodyText>
                {organiserName === null
                  ? t('offline', 'please_try_again')
                  : t('offline', 'please_try_again_organiser', { name: organiserName })}
              </BodyText>
            </Stack>
            {reference === undefined ? null : (
              <Notice kind="warn">{t('offline', 'reference', { reference })}</Notice>
            )}
          </>
        )}
      </Body>
      <Foot>
        <Button
          label={busy ? t('offline', 'sending') : t('offline', 'try_again')}
          onPress={onTryAgain}
          disabled={busy}
        />
      </Foot>
    </Screen>
  );
}

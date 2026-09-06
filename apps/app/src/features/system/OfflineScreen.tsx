import { Body, BodyText, Button, DisplayL, Foot, Notice, Screen, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Offline — scaffolded from `docs/design/Offline.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type OfflineProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function OfflineScreen({ onNext, onBack }: OfflineProps) {
  return (
    <Screen>
      <TopBar
        title={t('offline', 'catch_up_next_14_days')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('offline', 'your_times_are_saved_on_this_phone')}</DisplayL>
          <BodyText>{t('offline', 'we_couldnt_reach_brand_just_now_well')}</BodyText>
        </Stack>
        <Notice>{t('offline', 'offline_last_synced_2_minutes_ago')}</Notice>
        <Stack>
          <DisplayL>{t('offline', 'something_didnt_save')}</DisplayL>
          <BodyText>{t('offline', 'please_try_again_if_it_keeps_happening')}</BodyText>
        </Stack>
        <Notice kind="warn">{t('offline', 'ref_7f3k_2q_tue_15_sep_5')}</Notice>
      </Body>
      <Foot>
        <Button label={t('offline', 'try_again')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

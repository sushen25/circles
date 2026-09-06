import { Body, BodyText, Button, DisplayXL, Foot, Screen, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * LinkInvalid — scaffolded from `docs/design/LinkInvalid.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type LinkInvalidProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onWhatIsBrand?: (() => void) | undefined;
};

export function LinkInvalidScreen({ onBack, onWhatIsBrand }: LinkInvalidProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayXL>{t('linkInvalid', 'this_link_isnt_active_any_more')}</DisplayXL>
          <BodyText>{t('linkInvalid', 'the_circles_owner_may_have_reset_it')}</BodyText>
        </Stack>
      </Body>
      <Foot>
        <Button
          label={t('linkInvalid', 'what_is_brand')}
          variant="secondary"
          onPress={onWhatIsBrand}
        />
      </Foot>
    </Screen>
  );
}

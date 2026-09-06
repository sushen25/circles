import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Screen,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * WasThere — scaffolded from `docs/design/WasThere.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type WasThereProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function WasThereScreen({ onNext, onBack }: WasThereProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('wasThere', 'sunday_crew_thu_17_sep')}</Label>
          <DisplayXL>{t('wasThere', 'did_you_make_it_to_thursdays_catch')}</DisplayXL>
          <BodyText>{t('wasThere', 'helps_the_group_keep_a_light_record')}</BodyText>
        </Stack>
      </Body>
      <Foot>
        <Button label={t('wasThere', 'i_was_there')} onPress={onNext} />
        <Button label={t('wasThere', 'i_couldnt_make_it')} variant="secondary" onPress={onNext} />
        <Tertiary label={t('wasThere', 'not_now')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

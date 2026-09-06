import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Input,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * EnterCode — scaffolded from `docs/design/EnterCode.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type EnterCodeProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function EnterCodeScreen({ onNext, onBack }: EnterCodeProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('enterCode', 'enter_the_code_we_emailed')}</DisplayL>
          <BodyText>{t('enterCode', 'sent_to_maya_example_com_it_works')}</BodyText>
        </Stack>
        <Input />
        <Input />
        <Input />
        <Small>{t('enterCode', 'didnt_get_it_check_spam_or_send')}</Small>
      </Body>
      <Foot>
        <Button label={t('enterCode', 'continue')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

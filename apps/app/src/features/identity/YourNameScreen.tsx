import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Input,
  Label,
  Screen,
  Small,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * YourName — scaffolded from `docs/design/YourName.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type YourNameProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function YourNameScreen({ onNext, onBack }: YourNameProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('yourName', 'what_should_friends_call_you')}</DisplayL>
          <BodyText>{t('yourName', 'filled_in_from_your_google_account_change')}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('yourName', 'your_name')}</Label>
          <Input placeholder={t('yourName', 'maya')} />
        </Stack>
        <Card>
          <Row>
            <Stack>
              <Title>{t('yourName', 'time_zone')}</Title>
              <Small>{t('yourName', 'melbourne_aest_from_your_phone')}</Small>
            </Stack>
            <Small>{t('yourName', 'change')}</Small>
          </Row>
        </Card>
        <Small>{t('yourName', 'thats_all_we_need_no_photo_no')}</Small>
      </Body>
      <Foot>
        <Button label={t('yourName', 'continue')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}

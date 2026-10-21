import { Body, BodyText, Button, DisplayL, Screen } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * `/deleted` — the confirmation after Delete my account (S4-05, ADR 0083).
 *
 * The account is gone and the device is signed out by the time anyone sees it,
 * so it needs no session and asks nothing: it says it worked, what the friends
 * see and what happens in the thirty days. Static copy; "Done" goes to the
 * front page.
 */
export function DeletedScreen({ onDone }: { onDone?: (() => void) | undefined }) {
  return (
    <Screen>
      <Body>
        <Stack>
          <DisplayL>{t('account', 'deleted_title')}</DisplayL>
          <BodyText>{t('account', 'deleted_body')}</BodyText>
        </Stack>
        <Button label={t('account', 'deleted_done')} variant="secondary" onPress={onDone} />
      </Body>
    </Screen>
  );
}

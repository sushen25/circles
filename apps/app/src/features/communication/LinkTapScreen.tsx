import { Body, BodyText, Button, DisplayL, Foot, Screen, TopBar } from '../../components';
import { Stack } from '../../components/layout';

/**
 * The page an emailed single-use link opens on: one sentence and one button
 * (ADR 0023). It shows nothing the link could spend, so a mail gateway or a
 * link scanner that loads the page and runs its script changes nothing; the
 * token is posted only when the person taps. `/a` ("Get back in") and `/v`
 * ("Turn on updates") are both this screen, with their own words.
 *
 * `docs/design/ReentryConfirm.dc.html` and `EmailVerifyConfirm.dc.html`.
 */
export type LinkTapScreenProps = {
  title: string;
  body: string;
  button: string;
  busyLabel: string;
  busy?: boolean | undefined;
  onConfirm?: (() => void) | undefined;
};

export function LinkTapScreen({
  title,
  body,
  button,
  busyLabel,
  busy = false,
  onConfirm,
}: LinkTapScreenProps) {
  return (
    <Screen>
      <TopBar />
      <Body>
        <Stack>
          <DisplayL>{title}</DisplayL>
          <BodyText>{body}</BodyText>
        </Stack>
      </Body>
      <Foot>
        <Button label={button} busyLabel={busyLabel} busy={busy} onPress={onConfirm} />
      </Foot>
    </Screen>
  );
}

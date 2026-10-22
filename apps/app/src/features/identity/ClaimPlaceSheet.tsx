import { BodyText, Button, Sheet, Title } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * The step before a signed-in account takes a guest's place (SUS-245, ADR 0088):
 * somebody tapped a name on "Have you answered this before?", and nothing has
 * moved yet. Only "Yes" reattaches; "Not me" and the scrim close the sheet and
 * send nothing, so a wrong tap costs nothing. Presentational; the flow does the call.
 */
export function ClaimPlaceSheet({
  name,
  circleName,
  busy,
  onYes,
  onDismiss,
}: {
  /** The guest being claimed; the sheet is closed when undefined. */
  name: string | undefined;
  circleName: string;
  busy: boolean;
  onYes: () => void;
  onDismiss: () => void;
}) {
  const shown = name ?? '';
  const title = t('continueAs', 'claim_title', { name: shown, circle: circleName });
  return (
    <Sheet
      visible={name !== undefined}
      onDismiss={busy ? () => undefined : onDismiss}
      label={title}
      dismissLabel={t('common', 'cancel')}
    >
      <Stack>
        <Title>{title}</Title>
        <BodyText>{t('continueAs', 'claim_body', { name: shown, circle: circleName })}</BodyText>
      </Stack>
      <Button
        label={t('continueAs', 'claim_yes', { name: shown })}
        busyLabel={t('continueAs', 'rejoining')}
        busy={busy}
        onPress={onYes}
      />
      {busy ? null : (
        <Button label={t('continueAs', 'claim_no')} variant="secondary" onPress={onDismiss} />
      )}
    </Sheet>
  );
}

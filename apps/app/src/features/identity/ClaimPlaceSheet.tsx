import { useState } from 'react';

import { BodyText, Button, Sheet, Tertiary, Title } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * The step before a place moves (SUS-245, ADR 0088; a guest's pick too, SUS-250,
 * ADR 0092): somebody tapped a name on "Been here before?", and nothing has
 * moved yet. Only "Yes" reattaches; "Not me", Escape and the scrim close the
 * sheet and send nothing, so a wrong tap costs nothing. An account is asked
 * whether it takes the place, a guest whether the times come to this phone.
 * Presentational; the flow does the call.
 */
export function ClaimPlaceSheet({
  name,
  circleName,
  busy,
  forAccount = true,
  onYes,
  onDismiss,
}: {
  /** The guest being claimed; the sheet is closed when undefined. */
  name: string | undefined;
  circleName: string;
  busy: boolean;
  /** A signed-in account takes the place; a guest's times come to this phone. */
  forAccount?: boolean;
  onYes: () => void;
  onDismiss: () => void;
}) {
  // The sheet slides out after `name` is gone: keep what it said so it never reads "as ?".
  const [last, setLast] = useState('');
  if (name !== undefined && name !== last) setLast(name);
  const shown = name ?? last;
  const keys = forAccount
    ? ({ title: 'claim_title', body: 'claim_body', yes: 'claim_yes' } as const)
    : ({ title: 'carry_on_title', body: 'carry_on_body', yes: 'carry_on_yes' } as const);
  const title = t('continueAs', keys.title, { name: shown, circle: circleName });
  return (
    <Sheet
      visible={name !== undefined}
      onDismiss={busy ? () => undefined : onDismiss}
      label={title}
      dismissLabel={t('common', 'cancel')}
    >
      <Stack>
        <Title>{title}</Title>
        <BodyText>{t('continueAs', keys.body, { name: shown, circle: circleName })}</BodyText>
      </Stack>
      <Button
        label={t('continueAs', keys.yes, { name: shown })}
        busyLabel={t('continueAs', 'rejoining')}
        busy={busy}
        onPress={onYes}
      />
      {busy ? null : (
        <Tertiary label={t('continueAs', 'claim_no')} tone="plain" onPress={onDismiss} />
      )}
    </Sheet>
  );
}

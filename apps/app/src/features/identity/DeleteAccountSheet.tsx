import { BodyText, Button, Notice, Sheet, Small, Tertiary, Title } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { OwnedCircle } from '../../data/auth';

/**
 * Deleting the account, in two steps (S4-05, ADR 0083): what will happen, then
 * the one button that does it. The first step names every circle the person
 * owns and where it goes, because that is the part nobody expects: an owner
 * who deletes hands a circle to somebody, or archives it, and is told before
 * they choose. Presentational; the flow loads the circles and does the call.
 */
export type DeleteStep = 'explain' | 'sure';

export function DeleteAccountSheet({
  step,
  owned,
  loadingOwned,
  busy,
  problem,
  onContinue,
  onBack,
  onDelete,
  onDismiss,
}: {
  /** Closed when undefined. */
  step: DeleteStep | undefined;
  owned: readonly OwnedCircle[];
  /** The circles are still being worked out: Continue waits, so the warning is never skipped. */
  loadingOwned: boolean;
  busy: boolean;
  problem: string | undefined;
  onContinue: () => void;
  onBack: () => void;
  onDelete: () => void;
  onDismiss: () => void;
}) {
  const title = step === 'sure' ? t('account', 'delete_sure_title') : t('account', 'delete_title');
  return (
    <Sheet
      visible={step !== undefined}
      onDismiss={onDismiss}
      label={title}
      dismissLabel={t('common', 'cancel')}
    >
      <Stack>
        <Title>{title}</Title>
        <BodyText>
          {step === 'sure' ? t('account', 'delete_sure_body') : t('account', 'delete_body')}
        </BodyText>
        {step === 'explain' && owned.length > 0 ? (
          <Stack>
            <Small>{t('account', 'delete_owner_heading')}</Small>
            {owned.map((circle) => (
              <BodyText key={circle.circleId}>
                {circle.heirName === null
                  ? t('account', 'delete_archives', { circle: circle.name })
                  : t('account', 'delete_hands_on', { circle: circle.name, name: circle.heirName })}
              </BodyText>
            ))}
          </Stack>
        ) : null}
      </Stack>
      {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
      {step === 'sure' ? (
        <>
          <Button
            label={t('account', 'delete_now')}
            busyLabel={t('account', 'deleting')}
            variant="secondary"
            busy={busy}
            onPress={onDelete}
          />
          <Tertiary label={t('account', 'delete_back')} onPress={onBack} />
        </>
      ) : (
        <>
          <Button
            label={t('account', 'delete_continue')}
            variant="secondary"
            busy={loadingOwned}
            onPress={loadingOwned ? undefined : onContinue}
          />
          <Tertiary label={t('common', 'cancel')} onPress={onDismiss} />
        </>
      )}
    </Sheet>
  );
}

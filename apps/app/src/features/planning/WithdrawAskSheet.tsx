import { Button, Sheet, Small, Tertiary, Title } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * SparkWaiting's "Withdraw the ask?" (S2-03 step 3). It closes now, and
 * nobody is told it was asked: to everyone else a withdrawn ask and one that
 * ran out of time are the same nothing (`quietView`'s closed phase).
 */
export function WithdrawAskSheet({
  visible,
  busy,
  problem,
  onDismiss,
  onWithdraw,
}: {
  visible: boolean;
  busy: boolean;
  problem: string | undefined;
  onDismiss: () => void;
  onWithdraw: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      label={t('sparkWaiting', 'sheet_title')}
      dismissLabel={t('sparkWaiting', 'sheet_dismiss')}
    >
      <Stack>
        <Title>{t('sparkWaiting', 'sheet_title')}</Title>
        <Small>{t('sparkWaiting', 'sheet_body')}</Small>
        {problem === undefined ? null : <Small accessibilityLiveRegion="polite">{problem}</Small>}
      </Stack>
      <Button
        label={busy ? t('sparkWaiting', 'withdrawing') : t('sparkWaiting', 'withdraw')}
        disabled={busy}
        onPress={onWithdraw}
      />
      <Tertiary label={t('sparkWaiting', 'sheet_dismiss')} onPress={onDismiss} />
    </Sheet>
  );
}

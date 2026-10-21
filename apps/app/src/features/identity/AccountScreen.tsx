import type { ReactNode } from 'react';

import {
  Body,
  BodyText,
  Button,
  Card,
  CompactButton,
  DisplayL,
  Input,
  ListRow,
  Loading,
  Notice,
  Screen,
  SettingRow,
  Sheet,
  Tertiary,
  Title,
  TopBar,
  useLoadingHold,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { LoadFailed } from '../system/LoadFailed';

/**
 * Account — `docs/design/Account.dc.html` (spec §5.2): your name and time
 * zone, the address you sign in with, where Privacy and notifications live,
 * downloading your data, signing out, and deleting the account (S4-05, ADR
 * 0083). Deleting asks twice in a sheet the flow owns (`DeleteAccountSheet`),
 * and is drawn only when the flow can do it: a row that leads nowhere is worse
 * than none.
 */
export type AccountProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  name?: string | undefined;
  zone?: string | undefined;
  email?: string | undefined;
  problem?: string | undefined;
  /** The name sheet: open, what is typed, and whether it is saving. */
  editingName?: boolean | undefined;
  draftName?: string | undefined;
  nameProblem?: string | undefined;
  busy?: boolean | undefined;
  onChangeName?: (() => void) | undefined;
  onDraftName?: ((text: string) => void) | undefined;
  onSaveName?: (() => void) | undefined;
  onCloseName?: (() => void) | undefined;
  onChangeZone?: (() => void) | undefined;
  onPrivacy?: (() => void) | undefined;
  onNotifications?: (() => void) | undefined;
  onSignOut?: (() => void) | undefined;
  /** Download my data; omitted where the flow cannot do it (fixtures). */
  onExport?: (() => void) | undefined;
  exporting?: boolean | undefined;
  /** What the last export said, once it has said it. */
  exportNote?: { kind: 'ok' | 'warn'; text: string } | undefined;
  /** Opens the two-step delete; omitted where the flow cannot do it. */
  onDeleteAccount?: (() => void) | undefined;
  /** The delete sheet, rendered by the flow. */
  children?: ReactNode;
  onRetry?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function AccountScreen({
  state = 'default',
  name = t('account', 'maya'),
  zone = t('account', 'melbourne_aest'),
  email = t('account', 'maya_example_com'),
  problem,
  editingName = false,
  draftName = '',
  nameProblem,
  busy = false,
  onChangeName,
  onDraftName,
  onSaveName,
  onCloseName,
  onChangeZone,
  onPrivacy,
  onNotifications,
  onSignOut,
  onExport,
  exporting = false,
  exportNote,
  onDeleteAccount,
  children,
  onRetry,
  onBack,
}: AccountProps) {
  const loading = useLoadingHold(state === 'loading');
  const top = (
    <TopBar title={t('account', 'account')} onBack={onBack} backLabel={t('common', 'back')} />
  );

  if (loading) {
    return (
      <Loading
        message={t('account', 'loading')}
        shape="list"
        topTitle={t('account', 'account')}
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <LoadFailed
        state={state}
        message={t('account', state === 'offline' ? 'youre_offline' : 'couldnt_load')}
        where="circles"
        top={top}
        onRetry={onRetry}
      />
    );
  }

  return (
    <Screen>
      {top}
      <Body>
        <DisplayL>{t('account', 'you')}</DisplayL>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        <Card>
          <SettingRow title={t('account', 'name')} detail={name}>
            <CompactButton label={t('account', 'change')} onPress={onChangeName} />
          </SettingRow>
          <Divider />
          <SettingRow title={t('account', 'time_zone')} detail={zone}>
            <CompactButton label={t('account', 'change')} onPress={onChangeZone} />
          </SettingRow>
          <Divider />
          <SettingRow title={t('account', 'email')} detail={email} />
        </Card>
        <Card>
          <ListRow
            title={t('account', 'privacy')}
            detail={t('account', 'what_we_keep_what_friends_see')}
            label={t('account', 'row_label', {
              title: t('account', 'privacy'),
              detail: t('account', 'what_we_keep_what_friends_see'),
            })}
            onPress={onPrivacy}
          />
          <Divider />
          <ListRow
            title={t('account', 'notifications')}
            detail={t('account', 'notifications_detail')}
            label={t('account', 'row_label', {
              title: t('account', 'notifications'),
              detail: t('account', 'notifications_detail'),
            })}
            onPress={onNotifications}
          />
          {onExport === undefined ? null : (
            <>
              <Divider />
              <ListRow
                title={t('account', 'export_my_data')}
                detail={exporting ? t('account', 'exporting') : t('account', 'export_detail')}
                label={t('account', 'row_label', {
                  title: t('account', 'export_my_data'),
                  detail: t('account', 'export_detail'),
                })}
                onPress={exporting ? undefined : onExport}
              />
            </>
          )}
        </Card>
        {exportNote === undefined ? null : (
          <Notice kind={exportNote.kind}>{exportNote.text}</Notice>
        )}
        <Tertiary
          tone="plain"
          label={t('account', 'sign_out')}
          busyLabel={t('account', 'signing_out')}
          busy={busy && !editingName}
          onPress={onSignOut}
        />
        {onDeleteAccount === undefined ? null : (
          <Tertiary
            tone="plain"
            label={t('account', 'delete_my_account_and_data')}
            onPress={onDeleteAccount}
          />
        )}
      </Body>
      <Sheet
        visible={editingName}
        onDismiss={() => onCloseName?.()}
        label={t('account', 'name_title')}
        dismissLabel={t('common', 'cancel')}
      >
        <Stack>
          <Title>{t('account', 'name_title')}</Title>
          <BodyText>{t('account', 'name_hint')}</BodyText>
        </Stack>
        <Input
          aria-label={t('account', 'name')}
          value={draftName}
          onChangeText={onDraftName}
          autoCapitalize="words"
          maxLength={40}
          onSubmitEditing={onSaveName}
        />
        {nameProblem === undefined ? null : <Notice kind="warn">{nameProblem}</Notice>}
        <Button
          label={t('account', 'save')}
          busyLabel={t('account', 'saving')}
          busy={busy}
          onPress={onSaveName}
        />
        <Tertiary label={t('common', 'cancel')} onPress={onCloseName} />
      </Sheet>
      {children}
    </Screen>
  );
}

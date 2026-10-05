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

/**
 * Account — `docs/design/Account.dc.html` (spec §5.2): your name and time
 * zone, the address you sign in with, where Privacy and notifications live,
 * and signing out.
 *
 * "Delete my account and data" is on the artboard and is **not drawn**: it is
 * S4-05's (`delete-account`), and a row that leads nowhere is worse than none.
 * The artboard mapping still names it, so S4-05 knows where it goes.
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
      <Screen>
        {top}
        <Body>
          <DisplayL>
            {state === 'offline' ? t('account', 'youre_offline') : t('account', 'couldnt_load')}
          </DisplayL>
          <Button label={t('account', 'try_again')} onPress={onRetry} />
        </Body>
      </Screen>
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
        </Card>
        <Tertiary
          label={t('account', 'sign_out')}
          busyLabel={t('account', 'signing_out')}
          busy={busy && !editingName}
          onPress={onSignOut}
        />
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
    </Screen>
  );
}

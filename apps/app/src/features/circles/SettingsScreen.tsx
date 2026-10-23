import type { ReactNode } from 'react';

import {
  Body,
  Button,
  Card,
  CompactButton,
  DisplayL,
  Label,
  Notice,
  Screen,
  SettingRow,
  Small,
  Swatches,
  Tertiary,
  Title,
  Toggle,
  TopBar,
  Loading,
  useLoadingHold,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { colorName } from './CreateCircleScreen';
import { LoadFailed } from '../system/LoadFailed';

/**
 * Settings — `docs/design/Settings.dc.html` (spec §5.2): who is in, with **Add
 * someone** for any member and, for the owner alone, **Cancel old invitations**
 * (the reset, ADR 0091); then the rhythm and who gets nudged, the reader's own
 * quiet-asks switch, and Archive.
 *
 * The owner's decisions are drawn only for the owner (`canManage`, which is the
 * domain's `mayManageCircle`); a member sees what the circle is set to and
 * changes only their own switch. The server refuses the rest either way.
 * Presentational: the flow holds the sheets and passes them as `children`.
 */
export type SettingsMember = {
  userId: string;
  name: string;
  /** "You · owner", "Joined 3 Sep". */
  detail: string;
  removable: boolean;
  /** The reader's own row: where they change the name this circle calls them. */
  renamable: boolean;
};

export type SettingsProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  canManage?: boolean | undefined;
  ownerName?: string | undefined;
  /**
   * "Thursday Lot is full (20 people)": at the cap Add someone gives way to
   * this, since an invitation could only turn the next person away (ADR 0012).
   */
  full?: string | undefined;
  /** What the owner can do about it; the owner's alone. */
  fullHint?: string | undefined;
  /** What cancelling old invitations just did: "Old invitations cancelled…". */
  inviteNote?: string | undefined;
  cadenceLabel?: string | undefined;
  policyLabel?: string | undefined;
  color?: string | undefined;
  quietAsksOn?: boolean | undefined;
  members?: readonly SettingsMember[] | undefined;
  archived?: boolean | undefined;
  /** A write that did not land. */
  problem?: string | undefined;
  children?: ReactNode;
  /** Any member's; absent at the cap and in an archived circle. */
  onAddSomeone?: (() => void) | undefined;
  /** The owner's alone: it cuts off every invitation already in a chat. */
  onCancelInvitations?: (() => void) | undefined;
  onChangeCadence?: (() => void) | undefined;
  onChangePolicy?: (() => void) | undefined;
  onColorChange?: ((token: string) => void) | undefined;
  onQuietAsksChange?: ((on: boolean) => void) | undefined;
  onRemove?: ((userId: string) => void) | undefined;
  onRename?: (() => void) | undefined;
  onArchiveThisCircle?: (() => void) | undefined;
  /** Leave this circle, for a member who is not its owner (S4-05). */
  onLeaveThisCircle?: (() => void) | undefined;
  onBringBack?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function fixtureMembers(): SettingsMember[] {
  return [
    {
      userId: 'maya',
      name: t('settings', 'maya'),
      detail: t('settings', 'you_owner'),
      removable: false,
      renamable: true,
    },
    {
      userId: 'nina',
      name: t('settings', 'nina'),
      detail: t('settings', 'joined_3_sep'),
      removable: true,
      renamable: false,
    },
    {
      userId: 'alex',
      name: t('settings', 'alex'),
      detail: t('settings', 'guest_joined_3_sep'),
      removable: true,
      renamable: false,
    },
    {
      userId: 'tom',
      name: t('settings', 'tom'),
      detail: t('settings', 'joined_4_sep'),
      removable: true,
      renamable: false,
    },
    {
      userId: 'jess',
      name: t('settings', 'jess'),
      detail: t('settings', 'joined_4_sep'),
      removable: true,
      renamable: false,
    },
    {
      userId: 'sam',
      name: t('settings', 'sam'),
      detail: t('settings', 'joined_5_sep'),
      removable: true,
      renamable: false,
    },
  ];
}

export function SettingsScreen({
  state = 'default',
  circleName = t('settings', 'sunday_crew'),
  canManage = true,
  ownerName = t('settings', 'maya'),
  full,
  fullHint,
  inviteNote,
  cadenceLabel = t('settings', 'about_monthly'),
  policyLabel = t('settings', 'take_turns'),
  color = 'clay',
  quietAsksOn = true,
  members = fixtureMembers(),
  archived = false,
  problem,
  children,
  onAddSomeone,
  onCancelInvitations,
  onChangeCadence,
  onChangePolicy,
  onColorChange,
  onQuietAsksChange,
  onRemove,
  onRename,
  onArchiveThisCircle,
  onLeaveThisCircle,
  onBringBack,
  onRetry,
  onBack,
}: SettingsProps) {
  const top = (
    <TopBar
      title={t('settings', 'circle_settings')}
      onBack={onBack}
      backLabel={t('common', 'back')}
    />
  );

  const loading = useLoadingHold(state === 'loading');
  if (loading) {
    return (
      <Loading
        message={t('settings', 'loading')}
        shape="list"
        topTitle={circleName}
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <LoadFailed
        state={state}
        message={t('settings', state === 'offline' ? 'youre_offline' : 'couldnt_load')}
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
        <DisplayL>{t('settings', 'whos_in')}</DisplayL>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        <Card>
          {members.map((member, index) => (
            <Stack key={member.userId}>
              {index === 0 ? null : <Divider />}
              <SettingRow title={member.name} detail={member.detail}>
                {member.removable && onRemove !== undefined ? (
                  <CompactButton
                    label={t('settings', 'remove')}
                    aria-label={t('settings', 'remove_name', { name: member.name })}
                    onPress={() => onRemove(member.userId)}
                  />
                ) : null}
                {member.renamable && onRename !== undefined ? (
                  <CompactButton label={t('settings', 'change_my_name_here')} onPress={onRename} />
                ) : null}
              </SettingRow>
            </Stack>
          ))}
        </Card>
        {full !== undefined ? (
          <Card>
            <Label>{full}</Label>
            {fullHint === undefined ? null : <Small>{fullHint}</Small>}
          </Card>
        ) : onAddSomeone === undefined ? null : (
          <Stack>
            <CompactButton
              label={t('settings', 'add_someone')}
              icon="person-add"
              tone="accent"
              onPress={onAddSomeone}
            />
          </Stack>
        )}
        {onCancelInvitations === undefined ? null : (
          <Stack>
            <CompactButton
              label={t('settings', 'cancel_old_invitations')}
              onPress={onCancelInvitations}
            />
            <Small>{t('settings', 'cancel_old_invitations_line')}</Small>
            {inviteNote === undefined ? null : (
              <Small accessibilityLiveRegion="polite">{inviteNote}</Small>
            )}
          </Stack>
        )}
        <Card>
          <SettingRow title={t('settings', 'catch_up')} detail={cadenceLabel}>
            {canManage ? (
              <CompactButton label={t('settings', 'change')} onPress={onChangeCadence} />
            ) : null}
          </SettingRow>
          <Divider />
          <SettingRow
            title={t('settings', 'who_gets_nudged_to_plan_the_next')}
            detail={policyLabel}
          >
            {canManage ? (
              <CompactButton label={t('settings', 'change')} onPress={onChangePolicy} />
            ) : null}
          </SettingRow>
          {canManage ? (
            <>
              <Divider />
              <Stack>
                <Title>{t('settings', 'colour')}</Title>
                <Swatches
                  value={color}
                  onChange={(token) => onColorChange?.(token)}
                  labelFor={colorName}
                  label={t('settings', 'colour')}
                />
              </Stack>
            </>
          ) : null}
          <Divider />
          <SettingRow
            title={t('settings', 'quiet_asks')}
            detail={quietAsksOn ? t('settings', 'on') : t('settings', 'off')}
          >
            <Toggle
              value={quietAsksOn}
              onValueChange={(on) => onQuietAsksChange?.(on)}
              label={t('settings', 'quiet_asks')}
            />
          </SettingRow>
          <Small>{t('settings', 'quiet_asks_hint')}</Small>
          {canManage ? null : (
            <Small>{t('settings', 'only_the_owner', { owner: ownerName })}</Small>
          )}
        </Card>
        {canManage && !archived ? (
          <Tertiary
            tone="plain"
            label={t('settings', 'archive_this_circle')}
            onPress={onArchiveThisCircle}
          />
        ) : null}
        {canManage && archived ? (
          <Button label={t('settings', 'bring_back')} variant="secondary" onPress={onBringBack} />
        ) : null}
        {onLeaveThisCircle === undefined ? null : canManage ? (
          <Small>{t('settings', 'owner_cant_leave')}</Small>
        ) : (
          <Tertiary
            tone="plain"
            label={t('settings', 'leave_this_circle')}
            onPress={onLeaveThisCircle}
          />
        )}
      </Body>
      {children}
    </Screen>
  );
}

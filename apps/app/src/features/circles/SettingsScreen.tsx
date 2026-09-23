import type { ReactNode } from 'react';

import {
  Body,
  Button,
  ButtonRow,
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
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { colorName } from './CreateCircleScreen';

/**
 * Settings — `docs/design/Settings.dc.html` (spec §5.2): the invite link with
 * Copy and Reset, the rhythm and who gets nudged, the reader's own quiet-asks
 * switch, the members with Remove, and Archive.
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
};

export type InviteView =
  | { kind: 'loading' }
  | { kind: 'shown'; display: string }
  /** The live link cannot be shown again (ADR 00XX): reset it. */
  | { kind: 'unshowable' }
  /** Asking for it failed: that says nothing about the link, so try again, not reset. */
  | { kind: 'error' };

export type SettingsProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  canManage?: boolean | undefined;
  ownerName?: string | undefined;
  invite?: InviteView | undefined;
  /** What the last link action did: "Copied", "New link ready…". */
  linkNote?: string | undefined;
  cadenceLabel?: string | undefined;
  policyLabel?: string | undefined;
  color?: string | undefined;
  quietAsksOn?: boolean | undefined;
  members?: readonly SettingsMember[] | undefined;
  archived?: boolean | undefined;
  /** A write that did not land. */
  problem?: string | undefined;
  children?: ReactNode;
  onCopyLink?: (() => void) | undefined;
  onResetLink?: (() => void) | undefined;
  onRetryLink?: (() => void) | undefined;
  onChangeCadence?: (() => void) | undefined;
  onChangePolicy?: (() => void) | undefined;
  onColorChange?: ((token: string) => void) | undefined;
  onQuietAsksChange?: ((on: boolean) => void) | undefined;
  onRemove?: ((userId: string) => void) | undefined;
  onArchiveThisCircle?: (() => void) | undefined;
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
    },
    {
      userId: 'priya',
      name: t('settings', 'priya'),
      detail: t('settings', 'joined_3_sep'),
      removable: true,
    },
    {
      userId: 'alex',
      name: t('settings', 'alex'),
      detail: t('settings', 'joined_3_sep'),
      removable: true,
    },
    {
      userId: 'tom',
      name: t('settings', 'tom'),
      detail: t('settings', 'joined_4_sep'),
      removable: true,
    },
    {
      userId: 'jess',
      name: t('settings', 'jess'),
      detail: t('settings', 'joined_4_sep'),
      removable: true,
    },
    {
      userId: 'sam',
      name: t('settings', 'sam'),
      detail: t('settings', 'joined_5_sep'),
      removable: true,
    },
  ];
}

export function SettingsScreen({
  state = 'default',
  circleName = t('settings', 'sunday_crew'),
  canManage = true,
  ownerName = t('settings', 'maya'),
  invite = { kind: 'shown', display: t('settings', 'domain_join_7f3k') },
  linkNote,
  cadenceLabel = t('settings', 'about_monthly'),
  policyLabel = t('settings', 'take_turns'),
  color = 'clay',
  quietAsksOn = true,
  members = fixtureMembers(),
  archived = false,
  problem,
  children,
  onCopyLink,
  onResetLink,
  onRetryLink,
  onChangeCadence,
  onChangePolicy,
  onColorChange,
  onQuietAsksChange,
  onRemove,
  onArchiveThisCircle,
  onBringBack,
  onRetry,
  onBack,
}: SettingsProps) {
  const top = <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />;

  if (state === 'loading') {
    return (
      <Screen>
        {top}
        <Body>
          <Small accessibilityLiveRegion="polite">{t('settings', 'loading')}</Small>
        </Body>
      </Screen>
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        {top}
        <Body>
          <DisplayL>
            {state === 'offline' ? t('settings', 'youre_offline') : t('settings', 'couldnt_load')}
          </DisplayL>
          <Button label={t('settings', 'try_again')} onPress={onRetry} />
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      {top}
      <Body>
        <DisplayL>{t('settings', 'circle_settings')}</DisplayL>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        {canManage ? (
          <Card>
            <Label>{t('settings', 'invite_link')}</Label>
            {invite.kind === 'loading' ? <Small>{t('settings', 'link_loading')}</Small> : null}
            {invite.kind === 'shown' ? <Title>{invite.display}</Title> : null}
            {invite.kind === 'unshowable' ? <Small>{t('settings', 'link_not_shown')}</Small> : null}
            {invite.kind === 'error' ? (
              <SettingRow title={t('settings', 'link_couldnt_load')}>
                <CompactButton label={t('settings', 'try_again')} onPress={onRetryLink} />
              </SettingRow>
            ) : null}
            <ButtonRow>
              {invite.kind === 'shown' ? (
                <Button
                  label={t('settings', 'copy_link')}
                  variant="secondary"
                  onPress={onCopyLink}
                />
              ) : null}
              <Button
                label={t('settings', 'reset_link')}
                variant="secondary"
                onPress={onResetLink}
              />
            </ButtonRow>
            {linkNote === undefined ? null : (
              <Small accessibilityLiveRegion="polite">{linkNote}</Small>
            )}
            <Small>{t('settings', 'resetting_the_link_doesnt_affect_anyone_whos')}</Small>
          </Card>
        ) : null}
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
        <Stack>
          <Label>{t('settings', 'members')}</Label>
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
                </SettingRow>
              </Stack>
            ))}
          </Card>
        </Stack>
        {canManage && !archived ? (
          <Tertiary label={t('settings', 'archive_this_circle')} onPress={onArchiveThisCircle} />
        ) : null}
        {canManage && archived ? (
          <Button label={t('settings', 'bring_back')} variant="secondary" onPress={onBringBack} />
        ) : null}
      </Body>
      {children}
    </Screen>
  );
}

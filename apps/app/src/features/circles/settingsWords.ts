import {
  effectiveNudgePolicy,
  mayRemoveMember,
  type Cadence,
  type NudgePolicy,
} from '@circles/domain';

import { t } from '../../copy';
import type { CircleHome } from '../../data/circles';
import { dayWords } from '../planning/when';
import type { SettingsMember } from './SettingsScreen';
import type { PickerOption } from './sheets';
import { domainCircle } from './words';

/** Circle settings in words: the pickers' options and the members' lines. */

const CADENCE_LABELS: Record<Cadence, () => string> = {
  weekly: () => t('settings', 'cadence_weekly'),
  fortnightly: () => t('settings', 'cadence_fortnightly'),
  monthly: () => t('settings', 'cadence_monthly'),
  two_monthly: () => t('settings', 'cadence_two_monthly'),
  none: () => t('settings', 'cadence_none'),
};

const POLICY_LABELS: Record<NudgePolicy, () => string> = {
  take_turns: () => t('settings', 'policy_take_turns'),
  owner: () => t('settings', 'policy_owner'),
  last_organiser: () => t('settings', 'policy_last_organiser'),
};

export const cadenceLabel = (cadence: Cadence): string => CADENCE_LABELS[cadence]();

export function cadenceOptions(): PickerOption<Cadence>[] {
  return (Object.keys(CADENCE_LABELS) as Cadence[]).map((value) => ({
    value,
    label: CADENCE_LABELS[value](),
  }));
}

/**
 * Who is nudged, as the circle is set up now. With nothing chosen, the domain
 * resolves the default from the member count (take turns from four), so what
 * is shown is what would happen rather than "Default".
 */
export function policyOf(home: CircleHome): NudgePolicy {
  return effectiveNudgePolicy(
    {
      ...domainCircle(home),
      ...(home.nudgePolicy === null ? {} : { nudgePolicy: home.nudgePolicy }),
    },
    home.members.length,
  );
}

export const policyLabel = (policy: NudgePolicy): string => POLICY_LABELS[policy]();

export function policyOptions(): PickerOption<NudgePolicy>[] {
  return (['take_turns', 'owner', 'last_organiser'] as const).map((value) => ({
    value,
    label: POLICY_LABELS[value](),
  }));
}

/** "You · owner", "Owner", "You", "Joined 3 Sep" — and whether Remove is offered. */
export function memberRows(home: CircleHome): SettingsMember[] {
  return home.members.map((member) => {
    const you = member.userId === home.me;
    const owner = member.role === 'owner';
    const detail =
      you && owner
        ? t('settings', 'you_owner')
        : owner
          ? t('settings', 'owner')
          : you
            ? t('settings', 'you')
            : t('settings', 'joined_on', { date: dayWords(member.joinedAt, home.zone) });
    return {
      userId: member.userId,
      name: member.name,
      detail,
      removable: mayRemoveMember({ viewerIsOwner: home.isOwner, targetIsOwner: owner }),
    };
  });
}

/** "sundaycrew.app/join#…7f3k": enough to recognise the link, not enough to use it. */
export function linkDisplay(secret: string): string {
  return t('settings', 'link_ending', { tail: secret.slice(-4) });
}

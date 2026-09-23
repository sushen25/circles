import { Pressable } from 'react-native';

import { CompactButton, Icon, Marks, Small, usePalette, type Member } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { MARKS_MAX, marksMore } from './lines';

/**
 * The gear in a top bar: the reader's account on the circles list, the
 * circle's settings on its home (the artboards' `ic("gear")`). A 44pt target
 * that says where it goes.
 */
export function GearButton({
  label,
  onPress,
}: {
  label: string;
  onPress?: (() => void) | undefined;
}) {
  const palette = usePalette();
  if (onPress === undefined) return null;
  return (
    <Pressable role="button" aria-label={label} onPress={onPress} hitSlop={10}>
      <Icon name="gear" size={22} color={palette.ink2} />
    </Pressable>
  );
}

export function AccountButton({ onPress }: { onPress?: (() => void) | undefined }) {
  return <GearButton label={t('circlesList', 'account')} onPress={onPress} />;
}

export function SettingsButton({ onPress }: { onPress?: (() => void) | undefined }) {
  return <GearButton label={t('circleHome', 'settings')} onPress={onPress} />;
}

/**
 * The members row every circle-home state ends with: their marks, how many,
 * and — for the owner — the invite link (spec §5.2: "every state shows … members
 * and the invite link"). Stacked, so twenty marks and a count never have to fit
 * beside a link on one line (ADR 0012).
 */
export function MembersLine({
  members,
  memberCount,
  onInviteLink,
}: {
  members: readonly Member[];
  memberCount: string;
  onInviteLink?: (() => void) | undefined;
}) {
  return (
    <Stack>
      <Marks
        members={members}
        max={MARKS_MAX}
        more={marksMore}
        label={members.map((m) => m.name).join(', ')}
      />
      <Small>{memberCount}</Small>
      {onInviteLink === undefined ? null : (
        <CompactButton
          label={t('circleHome', 'invite_link')}
          icon="link"
          tone="accent"
          onPress={onInviteLink}
        />
      )}
    </Stack>
  );
}

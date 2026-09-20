import { StyleSheet, View } from 'react-native';

import { radius, space } from '@circles/tokens';

import {
  Body,
  BodyText,
  Button,
  Card,
  CompactButton,
  DisplayL,
  Foot,
  Icon,
  Label,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
  usePalette,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * The share screen, for the two things a circle ever shares: the plan link
 * (`PlanShared`) and the invite link (`InviteCircle`).
 *
 * One component, because the two are the same screen with different content —
 * a preview of what lands in the chat, the link on one line with a Copy that
 * confirms in place, a quiet sentence about who can use it, and a pinned
 * **Share to group chat** (ADR 0026, and the Invite artboards).
 *
 * What the organiser sends is never composed here: the message is the domain's
 * (`newPlanMessage`, `inviteMessage`), and every label is a copy key the caller
 * passes. **The raw link is not inside the message bubble** — the bubble shows
 * the sentence, the card under it shows where it goes, which is what a chat
 * app draws when the message arrives.
 */
export type ShareScreenProps = {
  /** "Step 2 of 2" on the first run; nothing when the screen is reached later. */
  step?: string | undefined;
  title: string;
  intro: string;
  /** The message as the chat will show it, from the domain. */
  message: string;
  /** The link card the chat draws under it: "Join Sunday Crew". */
  linkTitle: string;
  /** Its second line, which the OG preview has to agree with (S1-21). */
  linkSubtitle: string;
  /** The link itself, on one truncating line. */
  link: string;
  /** Who can use it, in one quiet sentence. */
  privacy: string;
  /** What the last tap did, said once. */
  outcome?: 'copied' | 'couldnt_copy' | undefined;
  /** What the screen is for: Share to group chat. */
  onShare?: (() => void) | undefined;
  onCopy?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  /**
   * Where to go next. Before a share it is a tertiary, because the screen has
   * one job; after one it becomes a secondary button, because the job is done.
   */
  onwardLabel: string;
  onOnward?: (() => void) | undefined;
  /** True once the message has left by any route: sheet, or copy. */
  shared?: boolean | undefined;
};

export function ShareScreen({
  step,
  title,
  intro,
  message,
  linkTitle,
  linkSubtitle,
  link,
  privacy,
  outcome,
  onShare,
  onCopy,
  onBack,
  onwardLabel,
  onOnward,
  shared = false,
}: ShareScreenProps) {
  const palette = usePalette();

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          {step === undefined ? null : <Label>{step}</Label>}
          <DisplayL>{title}</DisplayL>
          <BodyText>{intro}</BodyText>
        </Stack>

        <Stack gap={space.related}>
          <Small>{t('share', 'what_lands_in_the_chat')}</Small>
          <View style={[styles.thread, { backgroundColor: palette.line }]}>
            <Card style={styles.bubble} gap={10} padding={14}>
              <BodyText selectable>{message}</BodyText>
              <View style={[styles.preview, { borderColor: palette.line }]}>
                <Row gap={10}>
                  <Icon name="link" size={18} color={palette.ink2} />
                  <Stack gap={2}>
                    <Title>{linkTitle}</Title>
                    <Small>{linkSubtitle}</Small>
                  </Stack>
                </Row>
              </View>
            </Card>
          </View>
        </Stack>

        <Stack gap={space.related}>
          <View style={[styles.linkRow, { borderColor: palette.line }]}>
            <BodyText numberOfLines={1} selectable>
              {link}
            </BodyText>
            <CompactButton
              label={outcome === 'copied' ? t('share', 'copied') : t('share', 'copy')}
              icon={outcome === 'copied' ? 'check' : 'link'}
              tone={outcome === 'copied' ? 'plain' : 'accent'}
              onPress={onCopy}
              accessibilityLiveRegion="polite"
            />
          </View>
          <Row gap={8}>
            <Icon name="shield" size={14} color={palette.ink2} />
            <Small>{privacy}</Small>
          </Row>
          {outcome === 'couldnt_copy' ? <Small>{t('share', 'couldnt_copy')}</Small> : null}
        </Stack>
      </Body>
      <Foot>
        <Button label={t('share', 'share_to_group_chat')} onPress={onShare} />
        {shared ? (
          <Button label={onwardLabel} variant="secondary" onPress={onOnward} />
        ) : (
          <Tertiary label={onwardLabel} onPress={onOnward} />
        )}
      </Foot>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderBottomRightRadius: radius.chip,
  },
  linkRow: {
    alignItems: 'center',
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  preview: {
    borderRadius: radius.chip,
    borderWidth: 1,
    padding: 10,
  },
  thread: {
    borderRadius: radius.card,
    padding: 12,
  },
});

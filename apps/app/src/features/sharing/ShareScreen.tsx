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
  Title,
  TopBar,
  usePalette,
} from '../../components';
import { Stack } from '../../components/layout';
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
   * Where to go next: a secondary button, not a tertiary. It was a text link
   * under the primary and was too quiet to find — and on the plan's share
   * screen it is the step that ends the first run, so it has to be seen.
   */
  onwardLabel: string;
  onOnward?: (() => void) | undefined;
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
                <View style={styles.iconRow}>
                  <Icon name="link" size={18} color={palette.ink2} />
                  {/* The text takes what is left and wraps inside it. A row's
                      child is its own width by default, so both lines ran past
                      the card's edge on a phone. */}
                  <View style={styles.fill}>
                    <Stack gap={2}>
                      <Title>{linkTitle}</Title>
                      <Small>{linkSubtitle}</Small>
                    </Stack>
                  </View>
                </View>
              </View>
            </Card>
          </View>
        </Stack>

        <Stack gap={space.related}>
          <View style={[styles.linkRow, { borderColor: palette.line }]}>
            <View style={styles.fill}>
              <BodyText numberOfLines={1} selectable>
                {link}
              </BodyText>
            </View>
            <CompactButton
              label={outcome === 'copied' ? t('share', 'copied') : t('share', 'copy')}
              icon={outcome === 'copied' ? 'check' : 'link'}
              tone={outcome === 'copied' ? 'plain' : 'accent'}
              onPress={onCopy}
              accessibilityLiveRegion="polite"
            />
          </View>
          <View style={[styles.iconRow, styles.tightRow]}>
            <Icon name="shield" size={14} color={palette.ink2} />
            <View style={styles.fill}>
              <Small>{privacy}</Small>
            </View>
          </View>
          {outcome === 'couldnt_copy' ? <Small>{t('share', 'couldnt_copy')}</Small> : null}
        </Stack>
      </Body>
      <Foot>
        <Button label={t('share', 'share_to_group_chat')} onPress={onShare} />
        <Button label={onwardLabel} variant="secondary" onPress={onOnward} />
      </Foot>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderBottomRightRadius: radius.chip,
  },
  // An icon beside wrapping text sits on its first line, not halfway down the
  // paragraph it is labelling.
  iconRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  fill: {
    flex: 1,
    // Web needs this to let a flex child shrink below its content's width.
    minWidth: 0,
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
  tightRow: {
    gap: 8,
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

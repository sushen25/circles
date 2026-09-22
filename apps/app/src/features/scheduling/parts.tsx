import { Pressable } from 'react-native';

import {
  Body,
  BodyText,
  Button,
  Card,
  DateText,
  Label,
  Marks,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Between, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { CardView, HeaderView } from './view';

/**
 * The pieces every candidate screen is built from: the header that says who is
 * in and by when, the card that makes the argument for one option, and the
 * plain screens the eight states resolve to (manifesto §7).
 *
 * All presentational. Every string arrives worked out (`view.ts`), so the
 * gallery can show each state and the flows own the reading and the network.
 *
 * The header and the exception line are **stacked rather than set beside**
 * their marks, which is one deliberate departure from the artboards: those were
 * drawn for a circle of six, and at twenty "13 of 20 replied" and "Not Priya,
 * Tom and 5 others" are sentences that need the width of the screen (ADR 0012).
 */

/**
 * Marks drawn before the rest become a count. A circle holds twenty
 * (ADR 0012); eight is what fits on the narrowest phone, and the marks' own
 * accessible label still names everybody.
 */
export const MARKS_MAX = 8;

export function CandidateHeader({ header }: { header: HeaderView }) {
  return (
    <Stack gap={8}>
      <Row>
        {header.members.length === 0 ? null : (
          <Marks members={header.members} max={MARKS_MAX} label={header.marksLabel} />
        )}
        <Small>{header.replied}</Small>
      </Row>
      <Small>{header.closes}</Small>
      {header.zoneNote === undefined ? null : <Small>{header.zoneNote}</Small>}
    </Stack>
  );
}

export type CandidateCardProps = {
  card: CardView;
  /** The accent border: the one about to be reviewed, or rank 1 when nothing is. */
  highlighted: boolean;
  onPress?: (() => void) | undefined;
  selected?: boolean | undefined;
};

export function CandidateCard({ card, highlighted, onPress, selected }: CandidateCardProps) {
  const inside = (
    <Card recommended={highlighted}>
      <Between>
        <Label>{card.rank ?? card.count}</Label>
        {card.rank === undefined ? null : <Small>{card.count}</Small>}
      </Between>
      <Stack>
        <DateText>{card.date}</DateText>
        <BodyText>{card.time}</BodyText>
      </Stack>
      <Stack gap={8}>
        <Marks members={card.members} max={MARKS_MAX} label={card.membersLabel} />
        {card.exception === undefined ? null : <Small>{card.exception}</Small>}
      </Stack>
    </Card>
  );

  if (onPress === undefined) return inside;
  return (
    <Pressable
      role="button"
      aria-label={card.label}
      aria-pressed={selected ?? false}
      onPress={onPress}
    >
      {inside}
    </Pressable>
  );
}

export type PlaceholderProps = {
  /** The bar's title, when the screen has one to show. */
  topTitle?: string | undefined;
  message: string;
  detail?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

/** Loading, error, offline, denied and decided: one sentence and a way on. */
export function Placeholder({
  topTitle,
  message,
  detail,
  actionLabel,
  onAction,
  onBack,
}: PlaceholderProps) {
  return (
    <Screen>
      <TopBar title={topTitle} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <BodyText accessibilityLiveRegion="polite">{message}</BodyText>
          {detail === undefined ? null : <Small>{detail}</Small>}
        </Stack>
        {actionLabel === undefined ? null : (
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        )}
      </Body>
    </Screen>
  );
}

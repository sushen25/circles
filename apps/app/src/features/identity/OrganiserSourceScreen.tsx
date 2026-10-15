import { ORGANISER_SOURCES, type OrganiserSource } from '@circles/contracts';

import { Body, Chip, Chips, DisplayL, Foot, Screen, Small, Tertiary } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * OrganiserSource (SUS-171): "How did you hear about {brand}?", the one question
 * the organiser's gate asks, once per account, after the code is through. Four
 * answers and Skip; each is a single tap that goes straight on, and none of
 * them is a field. What was chosen is an analytics word and nothing else.
 */
export type OrganiserSourceProps = {
  onChoose?: ((source: OrganiserSource) => void) | undefined;
};

const WORDS = {
  friend_group: 'friend_group',
  reddit: 'reddit',
  meetup: 'meetup',
  other: 'other',
} as const;

export function OrganiserSourceScreen({ onChoose }: OrganiserSourceProps) {
  const answers = ORGANISER_SOURCES.filter(
    (source): source is keyof typeof WORDS => source !== 'skipped',
  );
  return (
    <Screen>
      <Body>
        <Stack gap={4}>
          <DisplayL>{t('organiserSource', 'heading')}</DisplayL>
          <Small>{t('organiserSource', 'detail')}</Small>
        </Stack>
        <Chips>
          {answers.map((source) => (
            <Chip
              key={source}
              label={t('organiserSource', WORDS[source])}
              onPress={() => onChoose?.(source)}
            />
          ))}
        </Chips>
      </Body>
      <Foot>
        <Tertiary label={t('organiserSource', 'skip')} onPress={() => onChoose?.('skipped')} />
      </Foot>
    </Screen>
  );
}

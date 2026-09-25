import { Button, Card, Label, Small } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { HomeQuietAsk } from '../../data/circles';
import { whenWords } from './when';

/**
 * Circle home's "Asked quietly · closes Fri 11 Sep, 12 pm" (spec §5.4, S2-03
 * step 9). **The same card for every member, the one who asked included**: no
 * count, no name, no badge — nothing that, read over a shoulder, says whose
 * ask it is. Its button leads to the quiet screens, which show each reader
 * what is theirs.
 */
export function QuietAskCard({
  ask,
  zone,
  onOpen,
}: {
  ask: HomeQuietAsk;
  zone: string;
  onOpen: () => void;
}) {
  return (
    <Card>
      <Stack>
        <Label>{t('quiet', 'asked_quietly')}</Label>
        <Small>{t('quiet', 'closes', { when: whenWords(ask.closesAt, zone) })}</Small>
      </Stack>
      <Button label={t('quiet', 'take_a_look')} variant="secondary" onPress={onOpen} />
    </Card>
  );
}

import {
  Body,
  Button,
  Card,
  CircleBadge,
  DisplayL,
  Foot,
  ListRow,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { AccountButton } from './parts';

/**
 * CirclesList — `docs/design/CirclesList.dc.html` (spec §5.2): each circle as
 * its colour, its name and the one line that says where it is, and "New
 * circle". The gear is the reader's account.
 *
 * With no rows the flow shows `EmptyCirclesListScreen` instead, the first-run
 * variant; this screen draws only what it is given.
 */
export type CircleRow = {
  id: string;
  name: string;
  color: string;
  /** "Finding a time · 5 of 6 replied". */
  line: string;
};

export type CirclesListProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  rows?: readonly CircleRow[] | undefined;
  onOpen?: ((id: string) => void) | undefined;
  onNewCircle?: (() => void) | undefined;
  onAccount?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** Unused: the list has no single next step. Kept for the gallery's props. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

/** The artboard's three, for the gallery and a build with no backend. */
function fixtureRows(): CircleRow[] {
  return [
    {
      id: 'sunday-crew',
      name: t('circlesList', 'sunday_crew'),
      color: 'clay',
      line: t('circlesList', 'finding_a_time_5_of_6_replied'),
    },
    {
      id: 'uni-mates',
      name: t('circlesList', 'uni_mates'),
      color: 'moss',
      line: t('circlesList', 'last_caught_up_2_aug_no_rush'),
    },
    {
      id: 'book-club',
      name: t('circlesList', 'book_club'),
      color: 'plum',
      line: t('circlesList', 'locked_in_thu_24_sep'),
    },
  ];
}

export function CirclesListScreen({
  state = 'default',
  rows = fixtureRows(),
  onOpen,
  onNewCircle,
  onAccount,
  onRetry,
  onBack,
}: CirclesListProps) {
  const top = <TopBar onBack={onBack} right={<AccountButton onPress={onAccount} />} />;

  if (state === 'loading') {
    return (
      <Screen>
        {top}
        <Body>
          <Small accessibilityLiveRegion="polite">{t('circlesList', 'loading')}</Small>
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
            {state === 'offline'
              ? t('circlesList', 'youre_offline')
              : t('circlesList', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('circlesList', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  return (
    <Screen>
      {top}
      <Body>
        <DisplayL>{t('circlesList', 'your_circles')}</DisplayL>
        {rows.map((row) => (
          <Card key={row.id} padding={8} gap={0}>
            <ListRow
              title={row.name}
              detail={row.line}
              label={t('circlesList', 'row_label', { name: row.name, line: row.line })}
              leading={<CircleBadge name={row.name} color={row.color} />}
              onPress={onOpen === undefined ? undefined : () => onOpen(row.id)}
            />
          </Card>
        ))}
      </Body>
      <Foot>
        <Button label={t('circlesList', 'new_circle')} variant="secondary" onPress={onNewCircle} />
      </Foot>
    </Screen>
  );
}

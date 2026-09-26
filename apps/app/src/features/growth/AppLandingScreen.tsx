import { brand } from '@circles/config';

import {
  Body,
  BodyText,
  Button,
  Card,
  CircleBadge,
  DisplayL,
  DisplayXL,
  Foot,
  ListRow,
  Notice,
  Screen,
  Small,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * AppLanding — `docs/design/AppLanding.dc.html`, canvas page 5 (S3-01a): the
 * installed app's first open, signed in. Their circles, each with the line
 * that says where it is, and the one thing that changed: links from the group
 * chat open here now. **No push ask** — that is asked in context, when there
 * is a reminder to send (S3-03).
 *
 * The one decision opens the first circle; the list opens any of them. The
 * flow (`AppLandingFlow`) supplies the rows, and with none the gallery's
 * artboard is drawn.
 */
export type AppLandingRow = {
  id: string;
  name: string;
  color: string;
  /** "Locked in · Thu 17 Sep". */
  line: string;
};

export type AppLandingProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  /** Their display name, or null when it could not be read. */
  name?: string | null | undefined;
  rows?: readonly AppLandingRow[] | undefined;
  onOpen?: ((id: string) => void) | undefined;
  /** The screen's one decision: the first circle, or the list. */
  onNext?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function fixtureRows(): AppLandingRow[] {
  return [
    {
      id: 'sunday-crew',
      name: t('appLanding', 'sunday_crew'),
      color: 'clay',
      line: t('appLanding', 'locked_in_thu_17_sep_youre_going'),
    },
  ];
}

export function AppLandingScreen({
  state = 'default',
  name,
  rows,
  onOpen,
  onNext,
  onRetry,
}: AppLandingProps) {
  const fixture = rows === undefined;
  const shown = rows ?? fixtureRows();
  const first = shown[0];

  if (state === 'loading') {
    return (
      <Screen>
        <Body>
          <DisplayL>{brand.name}</DisplayL>
          <Small accessibilityLiveRegion="polite">{t('appLanding', 'loading')}</Small>
        </Body>
      </Screen>
    );
  }

  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <Body>
          <DisplayL>
            {state === 'offline'
              ? t('appLanding', 'youre_offline')
              : t('appLanding', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('appLanding', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  const greeting = fixture
    ? t('appLanding', 'welcome_back_priya')
    : name === null || name === undefined
      ? t('appLanding', 'welcome_back_no_name')
      : t('appLanding', 'welcome_back', { name });
  const primary =
    first === undefined
      ? t('appLanding', 'see_your_circles')
      : fixture
        ? t('appLanding', 'open_sunday_crew')
        : t('appLanding', 'open_circle', { name: first.name });

  return (
    <Screen>
      <Body>
        <DisplayL>{brand.name}</DisplayL>
        <Stack>
          <DisplayXL>{greeting}</DisplayXL>
          <BodyText>
            {fixture
              ? t('appLanding', 'signed_in_as_priya_example_com_your')
              : t('appLanding', 'circles_are_here')}
          </BodyText>
        </Stack>
        {shown.map((row) => (
          <Card key={row.id} padding={8} gap={0}>
            <ListRow
              title={row.name}
              detail={row.line}
              label={t('appLanding', 'row_label', { name: row.name, line: row.line })}
              leading={<CircleBadge name={row.name} color={row.color} />}
              onPress={onOpen === undefined ? undefined : () => onOpen(row.id)}
            />
          </Card>
        ))}
        <Notice>{t('appLanding', 'links_you_tap_from_the_group_chat')}</Notice>
      </Body>
      <Foot>
        <Button label={primary} onPress={onNext} />
        <Small>
          {fixture
            ? t('appLanding', 'reminders_come_on_thursday_well_ask_about')
            : t('appLanding', 'no_push_ask')}
        </Small>
      </Foot>
    </Screen>
  );
}

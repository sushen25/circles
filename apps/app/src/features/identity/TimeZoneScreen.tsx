import { Fragment } from 'react';
import { Pressable } from 'react-native';

import {
  Body,
  BodyText,
  Card,
  DisplayL,
  Icon,
  Input,
  Label,
  Screen,
  Small,
  Title,
  TopBar,
} from '../../components';
import { Between, Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ZoneGroup } from './zones';

/**
 * Choosing a time zone (S1-22): IANA zones grouped by region, with a filter.
 *
 * Reached from Your name's "Change", and optional — the device's zone is
 * already chosen — so the filter is not one of the flow's two typed inputs.
 * Every zone is offered by city, as a person thinks of it, never as an offset.
 */
export type TimeZoneProps = {
  groups: readonly ZoneGroup[];
  selected: string;
  query: string;
  onQueryChange: (query: string) => void;
  onPick: (zone: string) => void;
  onBack: () => void;
};

export function TimeZoneScreen({
  groups,
  selected,
  query,
  onQueryChange,
  onPick,
  onBack,
}: TimeZoneProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('timeZone', 'choose_your_time_zone')}</DisplayL>
          <BodyText>{t('timeZone', 'times_in_plans_show_in_it')}</BodyText>
        </Stack>
        <Input
          aria-label={t('timeZone', 'search')}
          placeholder={t('timeZone', 'search_placeholder')}
          value={query}
          onChangeText={onQueryChange}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {groups.length === 0 ? <Small>{t('timeZone', 'no_match')}</Small> : null}
        {groups.map((group) => (
          <Stack key={group.region}>
            <Label>{group.region}</Label>
            <Card>
              {group.zones.map((zone, index) => (
                <Fragment key={zone.id}>
                  {index === 0 ? null : <Divider />}
                  <Pressable
                    role="radio"
                    aria-checked={zone.id === selected}
                    aria-label={zone.city}
                    onPress={() => onPick(zone.id)}
                  >
                    <Between>
                      <Title>{zone.city}</Title>
                      {zone.id === selected ? <Icon name="check" size={18} /> : null}
                    </Between>
                  </Pressable>
                </Fragment>
              ))}
            </Card>
          </Stack>
        ))}
      </Body>
    </Screen>
  );
}

import { BodyText, Button, Chip, Chips, Label, Sheet, Small, Title } from '../../components';
import { Between, Stack } from '../../components/layout';
import { t } from '../../copy';
import { Stepper } from './parts';

/**
 * The two sheets behind the setup card's rows: when replies close, and who has
 * to be there. Presentational; `useDeadlineSheet` and the flows work out what
 * they offer.
 */

export type Option = { key: string; label: string; detail?: string | undefined; selected: boolean };

export type DeadlineSheetProps = {
  visible: boolean;
  choices: Option[];
  onChoose: (key: string) => void;
  days: Option[];
  onDay: (key: string) => void;
  time: string;
  canEarlier: boolean;
  canLater: boolean;
  onEarlier: () => void;
  onLater: () => void;
  /** The day and time picked, when it is allowed; the reason it is not otherwise. */
  pickedAllowed: boolean;
  onUsePicked: () => void;
  latestNote: string;
  onDismiss: () => void;
};

export function DeadlineSheet(props: DeadlineSheetProps) {
  return (
    <Sheet
      visible={props.visible}
      onDismiss={props.onDismiss}
      label={t('planSetup', 'deadline_sheet_title')}
      dismissLabel={t('common', 'close')}
    >
      <Title>{t('planSetup', 'deadline_sheet_title')}</Title>
      <Chips>
        {props.choices.map((choice) => (
          <Chip
            key={choice.key}
            label={choice.label}
            detail={choice.detail}
            selected={choice.selected}
            onPress={() => props.onChoose(choice.key)}
          />
        ))}
      </Chips>
      <Label>{t('planSetup', 'deadline_pick')}</Label>
      <Chips>
        {props.days.map((day) => (
          <Chip
            key={day.key}
            label={day.label}
            selected={day.selected}
            onPress={() => props.onDay(day.key)}
          />
        ))}
      </Chips>
      <Between>
        <Title>{props.time}</Title>
        <Stepper
          fewerLabel={t('planSetup', 'earlier')}
          moreLabel={t('planSetup', 'later')}
          fewerSpoken={t('planSetup', 'deadline_earlier')}
          moreSpoken={t('planSetup', 'deadline_later')}
          canFewer={props.canEarlier}
          canMore={props.canLater}
          onFewer={props.onEarlier}
          onMore={props.onLater}
        />
      </Between>
      {props.pickedAllowed ? null : (
        <Small accessibilityLiveRegion="polite">{t('planSetup', 'deadline_not_allowed')}</Small>
      )}
      <Small>{props.latestNote}</Small>
      <Button
        label={t('planSetup', 'use_this_time')}
        variant="secondary"
        disabled={!props.pickedAllowed}
        onPress={props.onUsePicked}
      />
    </Sheet>
  );
}

export type RequiredSheetProps = {
  visible: boolean;
  people: Option[];
  /** An edit offers only the people this revision asks, and says so. */
  askedOnly?: boolean | undefined;
  onToggle: (key: string) => void;
  onDone: () => void;
};

export function RequiredSheet({
  visible,
  people,
  askedOnly,
  onToggle,
  onDone,
}: RequiredSheetProps) {
  return (
    <Sheet
      visible={visible}
      onDismiss={onDone}
      label={t('planSetup', 'required_sheet_title')}
      dismissLabel={t('common', 'close')}
    >
      <Stack>
        <Title>{t('planSetup', 'required_sheet_title')}</Title>
        <BodyText>{t('planSetup', 'required_sheet_body')}</BodyText>
      </Stack>
      <Chips>
        {people.map((person) => (
          <Chip
            key={person.key}
            label={person.label}
            selected={person.selected}
            onPress={() => onToggle(person.key)}
          />
        ))}
      </Chips>
      {askedOnly === true ? <Small>{t('planSetup', 'required_sheet_asked')}</Small> : null}
      <Button label={t('planSetup', 'done')} onPress={onDone} />
    </Sheet>
  );
}

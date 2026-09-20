import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Input,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Between, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * YourName — `docs/design/YourName.dc.html` (spec §5.1 step 3).
 *
 * One typed input, and a time zone that is already right. The name is empty on
 * the email path — an address is not a name (`SignedIn.suggestedName`) — and
 * prefilled once SSO exists (SUS-77), which is when "Filled in from your
 * Google account" becomes true; until then the screen says only what is.
 */
export type YourNameProblem = 'name_unusable' | 'couldnt_save' | 'offline';

export type YourNameProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  name?: string | undefined;
  /** Where the name came from, when it did not come from the person. */
  prefilledFrom?: 'google' | 'apple' | undefined;
  /** "Melbourne (AEST)". */
  zoneLabel?: string | undefined;
  /** The zone is this device's own, unchanged. */
  zoneFromDevice?: boolean | undefined;
  problem?: YourNameProblem | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onNameChange?: ((name: string) => void) | undefined;
  onChangeZone?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function problemCopy(problem: YourNameProblem): string {
  switch (problem) {
    case 'name_unusable':
      return t('yourName', 'name_unusable');
    case 'couldnt_save':
      return t('yourName', 'couldnt_save');
    case 'offline':
      return t('yourName', 'youre_offline');
  }
}

export function YourNameScreen({
  state = 'default',
  name = '',
  prefilledFrom,
  zoneLabel = t('yourName', 'melbourne_aest'),
  zoneFromDevice = true,
  problem,
  reference,
  busy = false,
  onNameChange,
  onChangeZone,
  onRetry,
  onNext,
  onBack,
}: YourNameProps) {
  if (state === 'loading') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('yourName', 'loading')}</Small>
        </Body>
      </Screen>
    );
  }

  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayL>
            {state === 'offline' ? t('yourName', 'youre_offline') : t('yourName', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('yourName', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('yourName', 'what_should_friends_call_you')}</DisplayL>
          <BodyText>
            {prefilledFrom === 'google'
              ? t('yourName', 'filled_in_from_your_google_account_change')
              : prefilledFrom === 'apple'
                ? t('yourName', 'filled_in_from_your_apple_account_change')
                : t('yourName', 'the_name_your_friends_know')}
          </BodyText>
        </Stack>
        <Stack>
          <Label>{t('yourName', 'your_name')}</Label>
          <Input
            aria-label={t('yourName', 'your_name')}
            placeholder={t('yourName', 'maya')}
            value={name}
            onChangeText={onNameChange}
            autoComplete="given-name"
            autoCapitalize="words"
            maxLength={40}
            onSubmitEditing={onNext}
          />
        </Stack>
        <Card>
          <Between>
            <Stack>
              <Title>{t('yourName', 'time_zone')}</Title>
              <Small>
                {zoneFromDevice
                  ? t('yourName', 'zone_from_your_phone', { zone: zoneLabel })
                  : zoneLabel}
              </Small>
            </Stack>
            <Tertiary
              label={t('yourName', 'change')}
              accessibilityHint={t('yourName', 'change_time_zone')}
              onPress={onChangeZone}
            />
          </Between>
        </Card>
        <Small>{t('yourName', 'thats_all_we_need_no_photo_no')}</Small>
        {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('yourName', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={busy ? t('yourName', 'saving') : t('yourName', 'continue')}
          onPress={onNext}
          disabled={busy}
        />
      </Foot>
    </Screen>
  );
}

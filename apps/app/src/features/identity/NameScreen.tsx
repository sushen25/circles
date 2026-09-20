import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Input,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Name — the one typed input a guest meets (`docs/design/Name.dc.html`).
 *
 * The refusals are inline rather than screens of their own, because every one
 * of them is answered by typing something else or waiting: a taken name, an
 * unusable one, a full circle, too many tries. Only an invite that has stopped
 * working leaves this screen, and the container does that.
 */
export type NameProblem =
  'name_taken' | 'name_unusable' | 'circle_full' | 'too_many_tries' | 'couldnt_join' | 'offline';

export type NameProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  inviterName?: string | null | undefined;
  value?: string | undefined;
  /** The name the server refused, which `name_taken` quotes back. */
  refusedName?: string | undefined;
  problem?: NameProblem | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  /**
   * An account naming itself for this circle, after its own name was taken
   * (ADR 0022). "No email, no password" would be untrue for them; what they
   * need to hear is that their profile is not being renamed.
   */
  forAccount?: boolean | undefined;
  onChangeText?: ((text: string) => void) | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  /**
   * "I have an account" beside a plan link's name step (ADR 0022). Left out on
   * a circle invite, and for an account naming itself, which is already in.
   */
  onHaveAccount?: (() => void) | undefined;
};

function problemCopy(problem: NameProblem, circle: string, name: string): string {
  switch (problem) {
    case 'name_taken':
      return t('name', 'name_taken', { circle, name });
    case 'name_unusable':
      return t('name', 'name_unusable');
    case 'circle_full':
      return t('name', 'circle_full', { circle });
    case 'too_many_tries':
      return t('name', 'too_many_tries');
    case 'offline':
      return t('name', 'youre_offline');
    case 'couldnt_join':
      return t('name', 'couldnt_join');
  }
}

export function NameScreen({
  fixture,
  circleName = fixture?.circle.name ?? '',
  inviterName = fixture?.circle.members[0]?.name ?? null,
  value,
  refusedName = '',
  problem,
  reference,
  busy = false,
  forAccount = false,
  onChangeText,
  onNext,
  onBack,
  onHaveAccount,
}: NameProps) {
  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('name', 'what_should_the_group_call_you')}</DisplayL>
          <BodyText>
            {forAccount
              ? t('name', 'just_for_this_circle', { circle: circleName })
              : t('name', 'just_a_first_name_is_fine_no')}
          </BodyText>
        </Stack>
        <Stack>
          <Label nativeID="guest-name-label">{t('name', 'your_name')}</Label>
          <Input
            accessibilityLabelledBy="guest-name-label"
            aria-label={t('name', 'your_name')}
            placeholder={t('name', 'priya')}
            value={value}
            onChangeText={onChangeText}
            onSubmitEditing={onNext}
            autoCapitalize="words"
            autoComplete="given-name"
            autoCorrect={false}
            maxLength={80}
            returnKeyType="go"
            editable={!busy}
          />
        </Stack>
        {problem === undefined ? (
          <Small>
            {inviterName === null
              ? t('name', 'this_is_what_the_circle_will_see')
              : t('name', 'this_is_what_the_others_will_see', { inviter: inviterName })}
          </Small>
        ) : (
          <Stack>
            <Notice kind="warn">{problemCopy(problem, circleName, refusedName)}</Notice>
            {reference === undefined ? null : (
              <Small>{t('name', 'reference', { reference })}</Small>
            )}
          </Stack>
        )}
      </Body>
      <Foot>
        <Button
          label={busy ? t('name', 'joining') : t('name', 'continue')}
          onPress={onNext}
          disabled={busy || (value !== undefined && value.trim() === '')}
        />
        {onHaveAccount === undefined ? null : (
          <Tertiary label={t('name', 'i_have_an_account')} onPress={onHaveAccount} />
        )}
      </Foot>
    </Screen>
  );
}

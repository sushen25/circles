import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Input,
  Label,
  LegalLine,
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
  | 'name_taken'
  | 'name_missing'
  | 'name_unusable'
  | 'circle_full'
  | 'too_many_tries'
  | 'couldnt_join'
  | 'offline';

export type NameProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
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
  /**
   * A plan link's name step (SUS-203): one line more under the heading, the effort
   * and the privacy promise, because nothing else has said either yet. Not on a
   * circle invite, whose context is spec §5.1's.
   */
  fromPlanLink?: boolean | undefined;
  onChangeText?: ((text: string) => void) | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  /**
   * "I have an account" beside a plan link's name step (ADR 0022). Left out on
   * a circle invite, and for an account naming itself, which is already in.
   */
  onHaveAccount?: (() => void) | undefined;
  /** The terms and the privacy page, linked under the button (S4-05). */
  onTerms?: (() => void) | undefined;
  onPrivacy?: (() => void) | undefined;
};

function problemCopy(problem: NameProblem, circle: string, name: string): string {
  switch (problem) {
    case 'name_taken':
      return t('name', 'name_taken', { circle, name });
    case 'name_missing':
      return t('name', 'name_missing');
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
  value,
  refusedName = '',
  problem,
  reference,
  busy = false,
  forAccount = false,
  fromPlanLink = false,
  onChangeText,
  onNext,
  onBack,
  onHaveAccount,
  onTerms,
  onPrivacy,
}: NameProps) {
  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('name', 'what_should_the_group_call_you')}</DisplayL>
          {/* A plan link says the effort and the privacy promise (SUS-203); the invite says what a first name needs. */}
          <BodyText>
            {forAccount
              ? t('name', 'just_for_this_circle', { circle: circleName })
              : fromPlanLink
                ? t('name', 'about_a_minute_and_nobody_sees_your_calendar')
                : t('name', 'just_a_first_name_is_fine_no')}
          </BodyText>
        </Stack>
        <Stack>
          <Label nativeID="guest-name-label">{t('name', 'your_first_name')}</Label>
          <Input
            accessibilityLabelledBy="guest-name-label"
            aria-label={t('name', 'your_first_name')}
            placeholder={t('name', 'your_first_name')}
            autoFocus
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
            {t('name', 'this_is_what_the_circle_will_call_you', { circle: circleName })}
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
          label={t('name', 'continue')}
          busyLabel={t('name', 'joining')}
          busy={busy}
          onPress={onNext}
        />
        {onHaveAccount === undefined ? null : (
          <Tertiary label={t('name', 'i_have_an_account')} onPress={onHaveAccount} />
        )}
        <LegalLine onTerms={onTerms} onPrivacy={onPrivacy} />
      </Foot>
    </Screen>
  );
}

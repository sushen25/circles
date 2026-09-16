import { Fragment } from 'react';
import { Pressable } from 'react-native';

import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Marks,
  Notice,
  Screen,
  Small,
  Title,
  TopBar,
} from '../../components';
import { Divider, Row } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * ContinueAs — somebody came back without their session (ADR 0006, spec §5.1).
 *
 * **A name and nothing else, per row.** The artboard drew a join date under
 * each; the list function does not return one, and ADR 0006 is the reason:
 * this is shown before anybody has proved they belong here, so it carries no
 * reply state, no email flag, and nothing that says who has been active. A
 * date that is not in the data cannot leak.
 */
export type ContinueOption = { key: string; name: string };

export type ContinueProblem =
  | { kind: 'reattach_limit'; name: string }
  | { kind: 'saved_place'; name: string }
  | { kind: 'too_many_tries' }
  | { kind: 'couldnt_rejoin' };

export type ContinueAsProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  options?: readonly ContinueOption[] | undefined;
  /**
   * A saved place is never offered a name: `reattach-member` refuses it with
   * `caller_is_permanent`, and a list whose every tap must fail is worse than
   * none. It gets "I'm new here" alone.
   */
  signedIn?: boolean | undefined;
  problem?: ContinueProblem | undefined;
  reference?: string | undefined;
  /** The option being reattached, while it is. */
  busyKey?: string | undefined;
  onPick?: ((option: ContinueOption) => void) | undefined;
  onImNewHere?: (() => void) | undefined;
  onSignIn?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function problemCopy(problem: ContinueProblem): string {
  switch (problem.kind) {
    case 'reattach_limit':
      return t('continueAs', 'reattach_limit', { name: problem.name });
    case 'saved_place':
      return t('continueAs', 'saved_place', { name: problem.name });
    case 'too_many_tries':
      return t('continueAs', 'too_many_tries');
    case 'couldnt_rejoin':
      return t('continueAs', 'couldnt_rejoin');
  }
}

export function ContinueAsScreen({
  fixture,
  state = 'default',
  circleName = fixture?.circle.name,
  options = fixture?.circle.members.map((m) => ({ key: m.name, name: m.name })) ?? [],
  signedIn = false,
  problem,
  reference,
  busyKey,
  onPick,
  onImNewHere,
  onSignIn,
  onRetry,
  onBack,
}: ContinueAsProps) {
  if (state === 'loading') {
    return (
      <Screen>
        <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('continueAs', 'finding_the_circle')}</Small>
        </Body>
      </Screen>
    );
  }

  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayL>
            {state === 'offline'
              ? t('continueAs', 'youre_offline')
              : t('continueAs', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('continueAs', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  const listed = signedIn ? [] : options;

  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{t('continueAs', 'welcome_back_which_one_is_you')}</DisplayL>
        {listed.length === 0 ? (
          <BodyText>
            {signedIn ? t('continueAs', 'signed_in_no_names') : t('continueAs', 'no_names_to_pick')}
          </BodyText>
        ) : (
          <>
            <BodyText>{t('continueAs', 'pick_your_name_to_carry_on_where')}</BodyText>
            <Card>
              {listed.map((option, index) => (
                <Fragment key={option.key}>
                  {index === 0 ? null : <Divider />}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('continueAs', 'continue_as', { name: option.name })}
                    accessibilityState={{ busy: busyKey === option.key }}
                    disabled={busyKey !== undefined}
                    onPress={() => onPick?.(option)}
                  >
                    <Row>
                      <Marks members={[{ name: option.name }]} />
                      <Title>
                        {busyKey === option.key ? t('continueAs', 'rejoining') : option.name}
                      </Title>
                    </Row>
                  </Pressable>
                </Fragment>
              ))}
            </Card>
          </>
        )}
        {problem === undefined ? null : <Notice kind="warn">{problemCopy(problem)}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('continueAs', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        {problem?.kind === 'saved_place' ? (
          <Button label={t('continueAs', 'sign_in')} onPress={onSignIn} />
        ) : null}
        <Button label={t('continueAs', 'im_new_here')} variant="secondary" onPress={onImNewHere} />
      </Foot>
    </Screen>
  );
}

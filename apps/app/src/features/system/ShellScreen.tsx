import { Body, Screen, Small, TopBar } from '../../components';
import { t } from '../../copy';

/**
 * What the served HTML shows, on every route, until React owns the page
 * (ADR 00XX).
 *
 * Deliberately knows nothing. The HTML is rendered once, at export, for every
 * visitor at once: it cannot tell a member from a stranger, a plan from a typo,
 * or Melbourne from Denver. So it says nothing that could turn out to be wrong
 * — no refusal, no date, no field to type into — and it is built like every
 * route's own loading state, so that the step from this to that one is a
 * change of words and not of layout.
 */
export function ShellScreen() {
  return (
    <Screen>
      <TopBar />
      <Body>
        <Small accessibilityLiveRegion="polite">{t('shell', 'loading')}</Small>
      </Body>
    </Screen>
  );
}

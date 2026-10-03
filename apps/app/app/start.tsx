import { WelcomeFlow } from '../src/features/identity/WelcomeFlow';
import { useSiteArrival } from '../src/features/site/useSiteArrival';

/**
 * `/start` — the app's front door on the web (ADR 00XX).
 *
 * The bare host serves the marketing site, so "Start a plan" lands here. It is
 * the same screen native opens at `/`; the only addition is the one event that
 * says the visitor came from the site. Route only, thin composition.
 */
export default function Route() {
  useSiteArrival();
  return <WelcomeFlow />;
}

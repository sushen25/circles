import { fragmentLinkKind } from '@circles/contracts';

import { captureTokenFragment } from '../links/tokens';
import { captureInviteFragment } from './invite';

/**
 * Imported for its effect by `index.ts`, before the router: every capability
 * that rides in a fragment — the circle invite and the emailed tokens — is
 * taken out of the address bar here (S1-24, ADR 0023).
 */
captureInviteFragment();
captureTokenFragment();

/**
 * A link opened in a tab that is already on its path.
 *
 * Pasting a link into that tab, or an in-app browser reusing it, changes only
 * the fragment, and a browser does not reload for that — so the capture above,
 * which runs once per page load, never sees the new capability, and the router
 * would pick it up and keep it in the address bar. Reloading keeps the fragment
 * and starts the page again, which puts it through the one path every link
 * takes. The router's own history writes never fire `hashchange`, so this
 * answers only a person.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('hashchange', () => {
    if (window.location.hash !== '' && fragmentLinkKind(window.location.pathname) !== null) {
      window.location.reload();
    }
  });
}

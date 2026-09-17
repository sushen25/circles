import { captureInviteFragment, isInvitePath } from './invite';

/** Imported for its effect by `index.ts`, before the router. See `captureInviteFragment`. */
captureInviteFragment();

/**
 * An invite opened in a tab that is already on `/join`.
 *
 * Pasting the link into that tab, or an in-app browser reusing it, changes only
 * the fragment, and a browser does not reload for that — so the capture above,
 * which runs once per page load, never sees the new secret, and the router would
 * pick it up and keep it in the address bar. Reloading keeps the fragment and
 * starts the page again, which puts it through the one path every invite takes.
 * The router's own history writes never fire `hashchange`, so this answers
 * only a person.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('hashchange', () => {
    if (window.location.hash !== '' && isInvitePath(window.location.pathname)) {
      window.location.reload();
    }
  });
}

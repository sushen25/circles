import { createContext, useContext } from 'react';

/**
 * The ways out of an error screen, supplied by the root layout (SUS-200).
 *
 * A screen cannot import the router (a unit test cannot load it, and a screen
 * that does is a screen that cannot be rendered on its own), so the layout, which
 * can, hands these down. Without a provider they do nothing, which is what a
 * test or the gallery wants.
 */
export type Exits = {
  /** Back to the list of circles. */
  circles: () => void;
  /** The start of the app: the welcome screen. */
  start: () => void;
  /** The same page again, from the address it already has. */
  reload: () => void;
};

const nothing = (): void => undefined;

const ExitsContext = createContext<Exits>({ circles: nothing, start: nothing, reload: nothing });

export const ExitsProvider = ExitsContext.Provider;

export function useExits(): Exits {
  return useContext(ExitsContext);
}

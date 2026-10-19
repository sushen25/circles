import { act, fireEvent } from '@testing-library/react';

/**
 * A tap that waits until the thing it taps is wired up (SUS-221).
 *
 * `findBy*` resolves the moment the element is in the DOM. react-native-web
 * hands a Pressable its new `onPress` from an effect, and React runs a commit's
 * effects from a task of its own, so the DOM can be ahead of the handler. On a
 * quiet machine the effect runs first; on a loaded one it can come second, the
 * tap lands on the previous handler (or none) and is lost. Nothing then fails
 * where it happened: the `waitFor` that expects the tap's effect waits out its
 * whole timeout for something that will never happen, and reports a timeout.
 *
 * Letting the effects run first, as a person's finger always does, makes the
 * order the same on every machine.
 */
export async function tap(target: Element | Promise<Element>): Promise<void> {
  const element = await target;
  await act(async () => undefined);
  fireEvent.click(element);
}

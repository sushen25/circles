/**
 * Space presses a checkbox or a switch.
 *
 * WAI-ARIA's keyboard pattern for both is Space, and react-native-web presses a
 * `Pressable` on Space only when its role is `button` (Enter works for every
 * role). So a painter cell, a shortcut chip and "I'm easy" could be reached by
 * Tab and not operated from the keyboard, which WCAG 2.1.1 does not allow and
 * spec §10 names: the availability grid must be operable without sight of it.
 *
 * `onKeyDown` is a react-native-web prop; native has no hardware-keyboard
 * press to handle here, so the handler is spread in rather than typed onto
 * `Pressable`.
 */
export function spaceToPress(onPress: (() => void) | undefined): Record<string, unknown> {
  if (onPress === undefined) return {};
  return {
    onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
      if (event.key !== ' ' && event.key !== 'Spacebar') return;
      // Otherwise the page scrolls as well.
      event.preventDefault?.();
      onPress();
    },
  };
}

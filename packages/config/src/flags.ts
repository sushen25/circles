/**
 * Features that are built but not yet switched on.
 *
 * A flag is a constant, not a remote setting: flipping one is a code change
 * that goes through review and the gate like any other, because each of these
 * guards a feature whose server side is not finished. Showing its door early
 * would put a person in front of a screen whose request is refused.
 *
 * Add one only for a feature that is half-landed, and delete it in the ticket
 * that lands the other half.
 */
export type Flags = {
  /**
   * "See if people are keen" — the quiet ask (spec §5.4). `create-plan` takes
   * `mode: 'quiet'` since S2-02, but its screens are S2-03's, so ChooseMode
   * hides the card until then. S2-03 turns this on and removes it.
   */
  readonly quietAsk: boolean;
};

export const flags: Flags = {
  quietAsk: false,
};

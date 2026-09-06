/**
 * Project-local ESLint rules. Small enough to read in a sitting, which is the
 * point: a rule nobody understands gets disabled rather than fixed.
 */
import copyVoice from './copy-voice.mjs';
import noLiteralJsxStrings from './no-literal-jsx-strings.mjs';

export default {
  rules: {
    'copy-voice': copyVoice,
    'no-literal-jsx-strings': noLiteralJsxStrings,
  },
};

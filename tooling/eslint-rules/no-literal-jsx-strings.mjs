/**
 * Every user-facing string is a key in `src/copy` (architecture §11).
 *
 * A literal in a component is not a small sin: it is a string that no reviewer
 * sees next to its neighbours, that no voice rule can check, and that has to be
 * hunted down when the product is renamed or translated.
 *
 * Flags text between JSX tags, and string literals passed to the props that end
 * up in front of a person — including the accessibility ones, which are copy
 * even though they are never seen.
 */
const VISIBLE_PROPS = new Set([
  'label',
  'title',
  'placeholder',
  'accessibilityLabel',
  'accessibilityHint',
  'aria-label',
  'aria-placeholder',
  'aria-valuetext',
  'noneLabel',
  'backLabel',
  'day',
]);

/** Punctuation and separators carry no voice and need no key. */
const NOT_COPY = /^[\s\p{P}\p{S}\d]*$/u;

export default {
  meta: {
    type: 'problem',
    docs: { description: 'user-facing strings must come from src/copy' },
    messages: {
      jsxText: 'Move this string into src/copy and read it with t(): {{ text }}',
      prop: '`{{ prop }}` is user-facing. Move the string into src/copy and read it with t().',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXText(node) {
        const text = node.value.trim();
        if (!text || NOT_COPY.test(text)) return;
        context.report({ node, messageId: 'jsxText', data: { text: text.slice(0, 40) } });
      },

      JSXAttribute(node) {
        const name = node.name.name;
        if (typeof name !== 'string' || !VISIBLE_PROPS.has(name)) return;

        const value = node.value;
        const literal =
          value?.type === 'Literal'
            ? value
            : value?.type === 'JSXExpressionContainer' && value.expression.type === 'Literal'
              ? value.expression
              : null;

        if (!literal || typeof literal.value !== 'string') return;
        if (NOT_COPY.test(literal.value)) return;
        context.report({ node: literal, messageId: 'prop', data: { prop: name } });
      },
    };
  },
};

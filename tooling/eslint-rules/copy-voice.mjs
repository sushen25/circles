/**
 * The voice rules from the design manifesto §4, enforced over the copy files.
 *
 * These are the two that go wrong silently as copy accumulates: cheerfulness
 * creeping in as exclamation marks, and the scoreboard vocabulary of habit apps
 * creeping in as "on track" and "streak". The product is not keeping score of
 * anyone's friendships, and the words are where that shows first.
 *
 * One exclamation mark is permitted on the confirmation, and only there —
 * "only if it earns itself" is a judgement a linter cannot make, but "not
 * anywhere else" is one it can.
 */
const BANNED = [
  { phrase: 'on track', why: 'the product does not keep score (manifesto §4)' },
  { phrase: 'overdue', why: 'a friendship is never overdue (manifesto §4)' },
  { phrase: "you haven't", why: 'never blame the reader; the subject is the situation' },
  { phrase: 'you haven’t', why: 'never blame the reader; the subject is the situation' },
  { phrase: 'streak', why: 'streaks are a scoreboard, not a relationship' },
];

/** Screens where a single exclamation mark is allowed. */
const CELEBRATION = /^confirmed/;

export default {
  meta: {
    type: 'problem',
    docs: { description: 'copy follows the voice rules in the design manifesto' },
    messages: {
      exclamation:
        'No exclamation marks outside the confirmation (manifesto §4). This is `{{ screen }}`.',
      banned: 'Avoid “{{ phrase }}” — {{ why }}.',
    },
    schema: [],
  },
  create(context) {
    /** The screen a string belongs to: the key of the object two levels up. */
    function screenOf(node) {
      for (let n = node.parent; n; n = n.parent) {
        if (n.type === 'Property' && n.parent?.parent?.type === 'Property' && n.parent.parent.key) {
          const key = n.parent.parent.key;
          return key.name ?? key.value ?? null;
        }
      }
      return null;
    }

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const text = node.value;

        if (text.includes('!')) {
          const screen = screenOf(node);
          if (!screen || !CELEBRATION.test(String(screen))) {
            context.report({
              node,
              messageId: 'exclamation',
              data: { screen: String(screen ?? 'this screen') },
            });
          }
        }

        const lower = text.toLowerCase();
        for (const { phrase, why } of BANNED) {
          if (lower.includes(phrase)) {
            context.report({ node, messageId: 'banned', data: { phrase, why } });
          }
        }
      },
    };
  },
};

---
name: hooks
description: Generate 6–8 candidate first lines for one Wenna hook family, each labelled by archetype and tied to a verbatim phrase from context/hooks.md. Use when asked for "hooks", "first lines", or "/hooks <family>".
---

# /hooks

Input: a family id from `context/hooks.md` (skit, catchup, pm, rhythm,
roster, drift, demo).

Read `context/voice.md`, `context/facts.md` and `context/hooks.md`.

Then read `context/learned.md`, the brief the nightly run writes from the
numbers. Prefer what "Do more of" names for this family, avoid what "Stop"
names, and treat "Too early" as no information at all. It never overrides
a rule in voice.md, facts.md or hooks.md, and it is never a source for a
claim: a number from it does not go into a slide or a caption.

Then:

1. Take the verbatim phrases under that family. If only `(seed)` placeholders
   exist, say so in one line and continue with the family's shape.
2. Write 6–8 hooks. Each under 50 characters, each in a named archetype from
   hooks.md (count, quote, time, role, contrast, plain). At least two must be
   `quote` archetype using a verbatim phrase unchanged.
3. No product name. No exclamation marks. No emoji. No question that the
   next line answers in one word.
4. Output a table: `# | archetype | hook | phrase it came from (or —)`.
5. End with one line: which one you would shoot today, and why, in under 20
   words.

Do not write captions or slides here. `/skit` does that.

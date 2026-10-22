# Experiments

One row per hook family per fortnight. One piece a day (`/daily`), rotating
through the live families; everything else waits. Shapes (from the skit
skill) rotate within a family, so a fortnight compares shapes as well as
families. Day 30: kill the two worst, double the best (with fewer than
three families ranked, the shrunk rule in `docs/analytics-plan.md`, "Phase
4, as built").

Metric: saves + shares per 1,000 views, per platform at day 7, against that
platform's median (`analytics/scorecard.md`; TikTok's views are typed by hand
weekly), and replies that quote the hook back. Likes are not a metric.
"Circles made" and "Plans shared" are counted by Wenna for circles that
carry this post's `?from=` tag (`lib/links.ts`; Wenna's `source_ref`,
circles SUS-240, read here through the export in SUS-244). "Plans shared" is
the only column that decides whether content is a channel. Both stay blank
until the export lands, rather than guessed. Nothing under three pieces is a
result: the scorecard lists it as too early.

| Fortnight | Family | Shape | Hypothesis | Pieces | Views (TikTok) | Saves+shares /1k | Circles made | Plans shared | Result | Next |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-20 → 11-02 | skit | skit (demo-first as the control) | A fictional chat with no product mention until the last slide outperforms a demo-first piece | | | | | | | |
| 2026-10-20 → 11-02 | pm | skit (2026-10-14 piece); quote-led next | "It's always you" is a hook people tag a friend on | | | | | | | |

---
name: retro
description: The fortnightly retro. Fills the ended fortnight's experiments.md rows from the scorecard with npm run retro, writes Result and Next from scorecard.md, proposes the next fortnight's rows, and opens one PR. Use for the fortnightly Routine or when asked "/retro".
---

# /retro

Close one fortnight of `experiments.md`. Do not post anything. Do not edit
`context/`, `queue/`, `published/` or anything under `analytics/`. The
numbers come from the script; you write only Result, Next and the proposed
rows, and merging the PR is the decision.

## Steps

1. `git checkout -b claude/retro-<fortnight start>` from `main` (the Circles
   repo; work in `content/`).
2. `npm run scorecard`, so the tables are as of now (the nightly run has
   usually done this; running it again changes nothing but the date).
3. `npm run retro -- --write` (or `-- --fortnight <start> --write` when
   asked for a particular one). It refuses when no fortnight has ended;
   stop there and say so, rather than filling a running one. It fills
   Pieces, Views (TikTok), Saves+shares /1k, Circles made and Plans shared
   in that fortnight's rows and prints them, with the day-30 lines for any
   family whose day 30 falls before the next retro. Never type a number
   into those cells yourself, and never change one the script wrote.
4. Read `analytics/scorecard.md` and, for each of the fortnight's rows,
   write the **Result** cell as one of:
   - `supported`: the scorecard ranks the comparison the hypothesis makes
     (n of 3 or more on each side) and it goes the hypothesis's way;
   - `refuted`: ranked, and it goes the other way;
   - `too early`: anything else. A comparison the scorecard lists under
     "Too early", or does not show at all, is `too early`, however it looks.
   Follow it with the evidence in a few words and its n, e.g.
   `supported: quote-led 1.6 against skit 0.9 (n=4 vs 3)`. Every number
   in Result is one `scorecard.md` shows ranked; none is computed or
   rounded by you, and none is taken from the row's own number cells,
   which show medians at any n.
5. Write the **Next** cell for each row in under fifteen words: keep,
   rotate the shape, change the hook, or stop.
6. Propose the next fortnight: append one row per family that stays live,
   with Fortnight (the day after this one ends → thirteen days later),
   Family, Shape (rotate within the family; keep `demo-first` as the
   control for as long as the control row is live), and a Hypothesis in one
   sentence. Leave every other cell empty.
7. **Day 30.** When `npm run retro` printed day-30 lines, apply the
   standing rule as a proposal: kill the two worst families, double the
   best, using only families the lines rank (with their n). A family that
   is "too early to rank" is neither killed nor doubled; say so. With
   fewer than three ranked families the rule shrinks, and never kills and
   doubles the same family:
   - three or more: kill the two lowest, double the highest;
   - two: double the higher; kill the lower only when its lift is 0.8 or
     less, otherwise keep it;
   - one or none: propose nothing, and say why.
   Put the proposal in the PR body, and reflect it in step 6's rows.
8. Commit `experiments.md` only. Push. Open a PR titled
   `content: retro <fortnight start>` with the body:
   - the filled rows as `npm run retro` printed them
   - each row's Result and Next, one line each
   - the day-30 proposal, if any
   - the proposed rows
   - `[ ] merge = accept the results and start the next fortnight` as a
     checkbox line

## Never

- Never fill a number cell by hand, and never change one the script wrote.
- Never write `supported` or `refuted` for something with n under 3.
- Never edit `context/` (`learned.md` included) or anything the nightly
  run writes.
- Never set a queue file's status or run `npm run publish`.

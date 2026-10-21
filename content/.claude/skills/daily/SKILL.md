---
name: daily
description: The scheduled entrypoint. Produces exactly one Wenna queue file for today, reviewed, rendered if possible, on a claude/ branch with a PR. Use for the daily Routine or when asked "/daily".
---

# /daily

Produce one piece for today. Do not post anything. Do not touch
`published/`. Do not edit `context/` except through `/mine`.

## Steps

1. `git checkout -b claude/YYYY-MM-DD-<family>` from `main` (the Circles repo; work in `content/`).
2. If `inbox/` has files, run `/mine` on each, then move them to
   `inbox/done/`.
3. Read `experiments.md`. Pick the live family with the fewest pieces this
   fortnight; tie → the one listed first.
4. Run `/hooks <family>`; take the one you'd shoot today.
5. Pick a shape from the table in `.claude/skills/skit/SKILL.md` that suits
   the family. Rotate: do not reuse the `shape` of the family's most recent
   piece across `queue/` and `published/`. For the first experiment row
   (skit, 2026-10-20 → 11-02) alternate `skit` with `demo-first`, the
   control arm. Run `/skit <family>` with that hook and shape. Write the
   queue file with `shape:` in its frontmatter. Set `publish_at` to today
   18:00 Melbourne (`+11:00` Oct–Mar, `+10:00` Apr–Sep) with
   `publish_window_minutes: 90`.
6. Run `npm run check queue/<file>.md`. Fix and re-run until it exits 0,
   the total is 24–32 s, product mentions sit only on the link chat and
   `end`, and the after is shorter than the before. Keep the last output
   for the PR body.
7. Run `/review` on the file. Fix, re-run the check, and re-review until
   `PASS`. Three fails → stop, commit what you have with
   `status: needs-human` and say why in the PR body.
8. If `node` and Playwright are available, run
   `npm run render queue/<file>.md` and confirm `out/<slug>/` has one PNG
   per slide and a `contact.png`; look at `contact.png`.
   If `ffmpeg` is also available, run `npm run video queue/<file>.md` and
   confirm `out/<slug>/<slug>.mp4` exists and its length matches the
   check's total. If either is not available, say so in the PR body;
   rendering is not required to merge.
9. Commit `queue/<file>.md` (and `context/hooks.md` if `/mine` changed it).
   Push. Open a PR titled `content: <date> <family> — <hook>` with the body:
   - the hook and archetype
   - the shape, and the check's total seconds (and before / after sums)
   - the TikTok caption (pasted onto the TikTok draft) and the YouTube title + line
   - the review result
   - `[ ] merge = approve for Bluesky/Threads/Instagram/LinkedIn/YouTube, and a TikTok draft` as a checkbox line

## Never

- Never set `status: approved` yourself. Merge is approval.
- Never run `npm run publish`.
- Never create more than one queue file per run.

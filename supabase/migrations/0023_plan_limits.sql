-- ---------------------------------------------------------------------------
-- 0023 — A plan may ask about up to thirty days and last up to five hours
-- (SUS-88, ADR 0030 and ADR 0031).
--
-- Two limits from spec §5.3 moved, by the founder's decision of 24 September
-- 2026 while reviewing the first screens on which an organiser picks their own
-- dates and length (S1-26):
--
--   * `plans_window_length` — 30 consecutive days, not 14. Inclusive as
--     before, so the 30th day is allowed and the 31st is not. The presets are
--     unchanged; only a custom window reaches this far.
--   * `plans_duration` and `circles_default_duration` — 240 and 300 minutes
--     join 60, 90, 120 and 180.
--
-- Replacing a check constraint is drop and add; Postgres has no alter for one.
-- Nothing stored can violate the new rules, which are wider than the old, so
-- the adds need no validation pass. `plans_band_fits` is untouched: a
-- five-hour meetup still needs a band that holds it, and the evenings band
-- (5:30–10:30 pm) holds it exactly.
-- ---------------------------------------------------------------------------

alter table public.plans
  drop constraint plans_window_length,
  add constraint plans_window_length check (window_end - window_start <= 29);

alter table public.plans
  drop constraint plans_duration,
  add constraint plans_duration check (duration_minutes in (60, 90, 120, 180, 240, 300));

alter table public.circles
  drop constraint circles_default_duration,
  add constraint circles_default_duration check (
    default_duration_minutes in (60, 90, 120, 180, 240, 300)
  );

-- The payload keys an action may carry. Anything else is refused, not ignored:
-- a caller that sends `quorum` with a `cancel` has misunderstood something,
-- and silently dropping it would let the misunderstanding ship.
--
-- `confirm` carries the confirmation's details as well as the candidate,
-- because `transition_plan` writes the confirmation row itself.

create or replace function planning.allowed_keys(action text)
returns text[]
language sql
immutable
as $$
  select case
    -- `adjust` takes these two and *only* these two, which is what makes the
    -- split between "changes the question" and "changes what happens to the
    -- answers" structural rather than a comparison somebody has to remember
    -- (spec §5.3). A window cannot ride along on an adjustment.
    when action = 'adjust' then array['quorum', 'response_deadline']
    -- The quorum alone. `quorum_follows` is the circle moving a quorum nobody
    -- chose (ADR 0026); a deadline riding along on it would be a change no
    -- organiser asked for and nobody announced.
    when action = 'quorum_follows' then array['quorum']
    when action in ('edit', 'reopen') then array[
      'window_start', 'window_end', 'daily_start_local', 'daily_end_local',
      'duration_minutes', 'quorum', 'response_deadline'
    ]
    when action = 'cancel' then array['cancel_note']
    -- A quiet ask opening is asked for times from that moment, so its deadline
    -- is set then: `defaultDeadline` for its window as of *now*, not as of when
    -- it was asked (`onThreshold`, spec §5.4.5). The only key it takes.
    when action = 'threshold_reached' then array['response_deadline']
    -- Who takes the plan over, and nothing else: a hand-off changes who
    -- decides, not what is being decided (S2-05).
    when action = 'hand_off' then array['organiser_user_id']
    when action = 'confirm' then array['candidate_id', 'place_name', 'place_url', 'note', 'chased_answer']
    else array[]::text[]
  end;
$$;

revoke all on function planning.allowed_keys(text) from public;
revoke all on function planning.allowed_keys(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- How long after a meetup its plan's link still offers Continue-as (ADR 0049).
--
-- One number, in one place, because three things read it and they must agree:
-- the list a guest picks their name from, the link-preview's circle name that
-- decides whether the screen says "this link isn't active", and the pgTAP that
-- proves the edge. Measured from the meetup's *end*, because that is when the
-- morning-after question and "I was there" open (spec §5.10).
--
-- Fourteen days: the morning-after letter goes out at nine the next morning,
-- and an organiser or a guest answering it a week late is ordinary; a second
-- week covers the guest whose Safari dropped its storage after seven idle days
-- (ADR 0006) and who opens the old link from the chat on the way back. After
-- that the plan's link is a forwarded screenshot, not somebody's way back, and
-- the emailed re-entry link still works for anybody who gave an address.
-- ---------------------------------------------------------------------------

create or replace function private.continue_as_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '14 days';
$$;

revoke all on function private.continue_as_window() from public;
revoke all on function private.continue_as_window() from anon, authenticated;

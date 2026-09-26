# Release: Slice 2 (relationship loop, web)

This is the founder's checklist for putting Slice 2 on `circles-prod`: the quiet
ask, cadence nudges, replies closed with no decision, the tonight and weekend
presets, and the guest → saved place prompts. Then groups 2 and 3 join, and the
H4–H6 evidence starts to build up. Written by SUS-56 (S2-08). **Nothing here has
been run against a hosted project.** The agent's session cannot reach one
(hosted reads are blocked), so every query below is for you to run.

It does not repeat [`environments.md`](./environments.md) or
[`environment-setup.md`](./environment-setup.md). Where a step is theirs, it
points there.

## Before anything: the prerequisites

Slice 2 goes out on top of Slice 1, not in place of it. Don't start this list
until these are Done:

- **SUS-48 (S1-32), the Slice 1 release.** It puts `0016`–`0024` on prod, deploys
  `process-scheduled-jobs`, sets the two cron database settings and turns the
  dispatcher on. Every letter in Slice 2 depends on that: the initiator's
  "enough people are keen", `about_time`, the day-later reminder and
  `quiet_expired` are all dispatcher jobs. Prod held `0001`–`0015` as of
  15 September. If SUS-48 has not run, `supabase db push` will apply `0016`–`0028`
  in one go, and SUS-48's own checks have to be done first. Its comments list
  them (below, *Checks carried from SUS-48*).
- **SUS-84, vendor and dashboard setup for the first real email:** the Resend
  webhook and `RESEND_WEBHOOK_SECRET`, the support address, DMARC reporting and
  the hosted auth templates. Slice 2 sends a lot more organiser-kind mail than
  Slice 1 did, and with no webhook a bounce is never recorded.

- **SUS-97, `quiet_threshold_reached` recorded.** The catalogue declares it,
  spec §15 lists it, and nothing emits it. The definition of done says an
  event is emitted and schema-tested, and H5 is the hypothesis this slice
  exists to test. Shipping without it means the cohort's first quiet asks
  leave no record of which ones opened, apart from what `public.plans` still
  shows. The queries under *Evidence* fall back to that, but it undercounts
  (below). Waive this only knowingly, and write down that you did in
  `cohort-1.md`.

Also due before any real inbox gets mail: **SUS-81**, the emailed tokens in URL
paths, which hosting logs keep. Slice 2 adds no new token, but it adds letters
that carry the existing ones.

## What deploys

`deploy-prod.yml` (with the `production` environment's required reviewer) does
all of it: `supabase db push --linked` (a dry run first), then
`supabase functions deploy` for every function, then the web build.

### Migrations

| Migration | What it does | Transaction |
|---|---|---|
| `0025_cadence.sql` | `private.cadence_prompts` (one decision per cycle, ADR 0036), `notification_jobs.circle_id` for `about_time` | **none**: applied statement by statement |
| `0026_quiet_ask.sql` | `quiet_preset`, the quiet constraints, the quiet transitions, `private.plan_initiators` / `plan_interest` writers, the quiet dispatcher functions | `begin` … `commit` |
| `0027_replies_closed.sql` | `deadline_extended_on_revision`, `hand_off`, the per-deadline and day-later `replies_closed` (ADR 0039), and the whole transitions table **deleted and rewritten** | **none** |
| `0028_growth_nudges.sql` | the new nudge moments, `answered_at`, `after_attendance_facts`, `claim_identity`'s two new moments | `begin` … `commit` |
| `0029_app_installed.sql` | **only if PR #95 (SUS-92) has merged by then**: `mark-app-installed`'s table | see PR #95 |

**`0025` and `0027` are not wrapped in a transaction** (SUS-48 comment, from
SUS-89: the CLI does not add one), so one that fails halfway stays half
applied. `0027` is the dangerous one. Between its `delete from
planning.transitions` and the `insert` that follows it, the state machine is
empty, and every transition is refused: no plan can be created, answered,
confirmed or cancelled. It is one statement after another, so the window is
milliseconds when it works. If the push fails inside `0027`, run the check under
*After the deploy* first, before anything else. If the table is empty, re-run
the `insert into planning.transitions …` statement from `0027` by hand; the
generated block is between the `delete` and the next comment.

### Edge Functions (new since Slice 1)

| Function | Ticket | Auth |
|---|---|---|
| `answer-interest` | SUS-50 | user JWT at the gateway |
| `accept-organiser` | SUS-50 | user JWT |
| `quiet-view` | SUS-50 | user JWT |
| `hand-off-organiser` | SUS-53 | user JWT |
| `extend-deadline` | SUS-53 | user JWT |
| `record-nudge` | SUS-55 | user JWT, so no `config.toml` block |
| `mark-app-installed` | SUS-92 | only if PR #95 has merged |

`create-plan` (quiet mode), `cancel-plan` (withdrawing an ask),
`process-scheduled-jobs` (cadence, quiet letters, replies closed) and
`track-events` (the unattributed quiet events) all change in place.

### Flags

None. **`quietAsk` no longer exists**: the quiet ask is always on (SUS-51).
The ticket's "enable the `quietAsk` flag" step is void.

### Cron and secrets

No new cron job and no new secret. Slice 2 runs on the minute `process-jobs`
job and the daily `retention` job that `0007` created. What it needs is what
SUS-48 sets up:

- `circles.functions_url` and `circles.cron_secret` set on `circles-prod`, with
  `CRON_SECRET` matching (see [`environments.md`](./environments.md), "Database
  settings the cron job reads").
- `HEALTH_REPORT_TO` set on prod. It is the only thing that will tell you a
  quiet or cadence job is failing.
- `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` (SUS-84).

## Before the deploy

Run these against `circles-prod` in the SQL editor.

```sql
-- 1. SUS-89 (only if 0024 is not applied yet): no circle may hold two open
--    plans, or 0024 refuses to apply. Rows here → cancel the older plan in
--    each circle from the app, which tells the people who answered it.
select circle_id, count(*) from public.plans
where state in ('collecting', 'ready') group by circle_id having count(*) > 1;

-- 2. What 0026 backfills: quiet plans made before the quiet ask existed.
--    Expected 0. Anything else, stop and read 0026's header first.
select count(*) from public.plans where mode = 'quiet';

-- 3. What 0028 deletes: nudge rows outside the new moments. Expected 0,
--    because no client wrote nudge_states before SUS-55.
select count(*) from public.nudge_states;

-- 4. The transitions table as it stands, to compare with after.
select count(*) from planning.transitions;
```

Also check that the prod project is **not paused** (Free plan, seven quiet days).
A push to a paused project looks like a credentials failure.

## After the deploy

```sql
-- The state machine is whole: 25 rows, including the quiet and hand-off moves.
select count(*) = 25 as whole,
       bool_or(action = 'create_quiet') as quiet,
       bool_or(action = 'threshold_reached') as opens,
       bool_or(action = 'accept_organiser') as role,
       bool_or(action = 'hand_off') as hand_off
from planning.transitions;

-- The dispatcher is running, not a no-op: look at the result, not the status.
select status, return_message, start_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'process-jobs')
order by start_time desc limit 5;
```

As the service role: `select public.dispatch_health(false);`, the one-line
health check SUS-36 left.

From outside, with a phone:

1. **Quiet ask.** In a circle of three saved places (you and two test accounts),
   use **Plan a catch-up** → **See if people are keen** → Next 7 days → **Ask
   quietly**. The other two answer **I'm keen** from circle home's "Asked
   quietly" card. Your inbox gets "*Circle*: enough people are keen". Its link
   opens **Volunteer** ("I'll pick the time"), not ThresholdRole. That is by
   design: a letter cannot say who is reading it.
2. **Cadence.** No quick way to test this on prod without waiting a month. The
   live suite's `cadence.spec.ts` sweeps it end to end locally. On prod, check
   the first real `about_time` after the cohort's first meetups (*Evidence*,
   below).
3. **Replies closed.** Let a test plan's deadline pass with one option and
   nothing locked in. "*Circle*: replies are closed" arrives. Its link has
   **Lock in**, **Give it one more day** and **Hand this to someone else**.
4. **The organiser gate.** From a guest browser (joined by link, never signed
   in), tap **See if people are keen**. "Save your place first" comes up. Once
   the place is saved, the quiet form follows.
5. `record-nudge` is deployed: a guest's first answer offers the email card, and
   the network panel shows `record-nudge` answering 200.

## Known risks going out

- **SUS-96: a second "replies are closed" letter by day.** When an organiser
  hands a plan over after its deadline but before the next minute's sweep has
  announced it, the new organiser gets two letters in daylight hours. The
  window is at most one cron tick, and they must reach the deadline screen and
  hand off inside it, so it is rare. Overnight, the second replaces the first.
  Known, open, and not a blocker unless the cohort hits it.
- **SUS-97, if it was waived above.** Until the event exists, the H5 queries
  read "the ask opened" from `public.plans`, and that is a lower bound.
- **A nudge that got nowhere is not sent again until the circle next meets**
  (ADR 0036, Consequences). A snooze after the nudge, a plan that was cancelled
  or did not happen, or a letter held at send time all leave circle home saying
  "About time" with no second message. If H6's evidence shows circles stalling
  after one ignored nudge, this is the rule to change, and changing it takes an
  ADR.
- **A keen guest is never offered the organiser role.** `quiet-view` gives
  `may_take_role` only to saved places (spec §4: guests cannot accept the
  role), so a guest sees "Choose my times" where a saved place sees "I'll pick
  the time". They meet the gate only on the doors that start something. If
  the cohort has keen guests who would have organised, that is a product
  question, not a bug.

## Decisions waiting on you before the cohort gate

These ADRs are still **proposed**. Accept or reject each one before groups 2 and
3 join, because the cohort will be living under them:

| ADR | Decision | From |
|---|---|---|
| [0034](../decisions/0034-ink-3-is-dark-enough-to-read.md) | `ink-3` darkened for contrast | S1-31 |
| [0036](../decisions/0036-the-cadence-nudge-is-decided-once-per-cycle.md) | one cadence nudge per cycle, never re-sent until the circle meets | SUS-52 |
| [0037](../decisions/0037-usual-times-are-read-not-written.md) | usual day-parts are read from past answers, not stored | SUS-54 |
| [0039](../decisions/0039-replies-closed-is-told-per-deadline-and-once-a-day-later.md) | replies closed: one letter per deadline, one more a day later | SUS-53 |
| [0040](../decisions/0040-the-served-html-is-a-shell.md) | the served HTML is a neutral shell | SUS-90 |
| [0041](../decisions/0041-keen-members-may-take-the-role-as-soon-as-it-opens.md) | keen members may take the role as soon as the ask opens | SUS-51 |
| 0042 (PR #95, drafted as `00XX`) | a link into the app takes the web's path | SUS-92 |

0038 (the initiator is written to at their own address) is already accepted.
0035 (the quiet ask at twenty members) is too.

## Checks carried from SUS-48

If SUS-48 has not already done these, they are due here:

- The `production` GitHub environment exists, with its own `EXPO_PUBLIC_*`
  variables pointing at `circles-prod` and a required reviewer. Without it a
  prod deploy quietly takes the repository's `dev` values.
- `pnpm check:env meet.sushensatturu.com` is six for six.
- `curl -s https://<domain>/p/<code>` contains `Getting things ready` (ADR 0040).
- The security-advisor table in `environments.md` is stale (SUS-48's comment
  of 15 September). Slice 2 adds definer functions and `private` tables, so
  expect more `authenticated_security_definer_function_executable` and
  `rls_enabled_no_policy` rows of the same kinds.

## Evidence for `docs/validation/cohort-1.md` (H4–H6)

Collect this six to eight weeks after groups 2 and 3 join, and write it into
`docs/validation/cohort-1.md` beside Slice 1's H1–H2 (SUS-48 starts that file).
The queries return counts only. **Don't select `user_id`, and don't join
`private.plan_initiators` to anything that returns a row per person.** An
initiator is never exposed (spec §8.2), and that includes to a spreadsheet.

**H4: quorum moves groups to a decision.** Success looks like this: groups
confirm even when not everyone can make it, and the replies-closed path is
rare.

```sql
-- Confirmed with fewer than everybody: how often "best enough" was enough.
select count(*) filter (where (properties ->> 'attending_count')::int
                              < (properties ->> 'invited_count')::int) as short_of_all,
       count(*) as confirmed
from analytics.events where event_name = 'meetup_confirmed';

-- What organisers did when replies closed with no decision.
select properties ->> 'action' as action, count(*)
from analytics.events where event_name = 'deadline_passed_action' group by 1;
```

**H5: quiet initiation changes who asks.** Success looks like this: members
other than the usual organiser make a quiet ask, and someone other than the
initiator takes the role in at least one.

```sql
-- Asks made, opened, and organised by somebody else. Counts only.
-- "Opened" from the plan alone is a lower bound: an ask that opened and was
-- later cancelled, or ran past its last start, looks like one that never did.
-- Once SUS-97 lands, count `quiet_threshold_reached` rows instead.
select count(*) as asks,
       count(*) filter (where p.state in ('collecting', 'ready', 'confirmed', 'completed')
                          or p.organiser_user_id is not null) as opened_at_least,
       count(*) filter (where p.organiser_user_id is not null
                          and p.organiser_user_id <> pi.initiator_user_id) as someone_else_organised
from public.plans p join private.plan_initiators pi on pi.plan_id = p.id
where p.mode = 'quiet';

-- Asks by people who had never organised a plan in that circle before.
select count(*) as asks_by_a_non_organiser
from public.plans q join private.plan_initiators pi on pi.plan_id = q.id
where q.mode = 'quiet' and not exists (
  select 1 from public.plans n
  where n.circle_id = q.circle_id
    and n.organiser_user_id = pi.initiator_user_id and n.created_at < q.created_at);
```

Ask the control question in the interviews too: "have you used a WhatsApp poll
for this?"

**H6: a meetup gives a reason to come back.** Success looks like this: a
meaningful share of circles plan a second meetup within their cadence, and
"take turns" nudges are acted on by someone other than the usual organiser.

```sql
-- Nudges sent, by why that person.
select properties ->> 'recipient_role' as role, count(*)
from analytics.events where event_name = 'cadence_prompt_sent' group by 1;

-- Circles that met at least twice.
select count(*) from (
  select p.circle_id from public.plans p
  join public.meetup_confirmations c on c.plan_id = p.id
  join public.outcome_reports o on o.confirmation_id = c.id and o.outcome = 'happened'
  group by p.circle_id having count(distinct p.id) >= 2) twice;

-- Nudges acted on: within 14 days of the nudge, the person asked organised a
-- plan in the circle or started a quiet ask there (whoever then organised it),
-- and whether they had organised there before. Counts only.
select count(*) as acted_on,
       count(*) filter (where not exists (
         select 1 from public.plans earlier
         where earlier.circle_id = cp.circle_id and earlier.organiser_user_id = cp.user_id
           and earlier.created_at < cp.prompted_at)) as by_a_first_time_organiser
from private.cadence_prompts cp
where cp.user_id is not null and exists (
  select 1 from public.plans p
  left join private.plan_initiators pi on pi.plan_id = p.id
  where p.circle_id = cp.circle_id
    and (p.organiser_user_id = cp.user_id or pi.initiator_user_id = cp.user_id)
    and p.created_at between cp.prompted_at and cp.prompted_at + interval '14 days');
```

Also record `plan_another_started` (Plan another, one tap) against
`plan_created`. Record the gate review itself (spec §15, Slice 2's exit: "a
non-usual organiser initiates; a circle returns; someone other than the
initiator organises a quiet plan") in `cohort-1.md` before any Slice 3 work on
real devices starts.

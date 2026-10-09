# Founder cohorts

Which spec §11.4 cohort a circle is counted in: `founder` (the test circles) or
`external`. The founder analytics screen counts each cohort's decision gates
over that cohort's circles alone. The reasoning is in
[ADR 0058](../decisions/0058-every-circle-carries-a-cohort-only-the-founder-can-see.md).
The cohort is never shown in the product and no user can read or set it.

## How a circle gets one

- **At creation:** `founder` when the owner is on `private.allowlist` (the same
  table that lets you into `/founder/analytics`), `external` otherwise.
- **Putting yourself on the allowlist later does not move circles you already
  made.** They are `external` until you set them.
- **A friend owns the test circle:** it is `external` by the rule. Set it.

Put yourself on the allowlist before you make test circles, and most need no
further step.

## See where circles stand

No circle name comes out of the analytics screen, so look in the database. Locally:

```bash
make psql
```

```sql
select c.name, c.created_at::date, cc.cohort, cc.source
from private.circle_cohorts cc
join public.circles c on c.id = cc.circle_id
order by c.created_at desc;
```

`source` is `default` when the rule put the circle there and `founder` when
somebody set it.

## Set one

As the database owner (local `make psql`; on a hosted project, the SQL editor):

```sql
update private.circle_cohorts
set cohort = 'founder', source = 'founder', set_at = now()
where circle_id = '<the circle id>';
```

`cohort` is `founder` or `external`; anything else is refused by a check.

Signed in as an allowlisted account, the same through the API:

```sql
select public.founder_set_circle_cohort('<the circle id>', 'founder');
```

Anyone not on the allowlist, and anon, is refused with `not_allowed`. It returns
nothing.

## What the numbers mean after

- Changing a cohort moves the circle's whole history: every gate is computed
  from the circles as they are now, not as they were when each event happened.
- An event that names no circle is placed by the circles its person belongs to:
  `founder` if any is a founder circle. One that cannot be placed (a visitor who
  never joined a circle) is in neither cohort.
- The funnel, the north star and the adoption lists are not split by cohort.

## When it goes wrong

- **Both cohorts look empty after a reset:** nobody is on `private.allowlist`
  locally, so every seeded circle is `external`. Insert yourself, then set the
  circles you want.
- **A gate reads "Too few to say" for the founder cohort:** the cohort has few
  circles. The screen says how many each cohort rests on.

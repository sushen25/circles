# Runbooks

What to do when something has gone wrong in a running environment. One file per
situation, written the first time it happens rather than imagined in advance.

| Runbook | For |
|---|---|
| [Local development](./local.md) | From a clean clone to the app running against a local database: env file, seed data, signing in, tests, and what breaks |
| [CI](./ci.md) | What each workflow does, what it costs, what still needs a person |
| [Environments](./environments.md) | What exists in `local`, `dev` and `prod`; domains, configuration, secrets, cost |
| [Environment setup](./environment-setup.md) | The one-time founder checklist that creates all of the above |
| Stuck plans | A plan that will not transition — past its deadline with no candidates, or a confirmation that did not send |
| Suppressed contacts | An address that has hard-bounced or complained and is no longer receiving anything |
| Identity merges | A guest who has ended up as two members of one circle, or a claim that half-linked |

The last three are named in architecture §18 and are **deliberately empty**.
They need a real incident to be worth anything: a runbook written before the
first occurrence documents what someone guessed would happen. Slice 4 hardening
is where they get filled in, or the first time one of these actually happens —
whichever comes first.

Every user-visible error carries a reference ("Ref 7F3K-2Q") that maps to a
request id in the logs. Start there.

## Stuck plans

_Empty. Write this the first time a plan gets stuck._

## Suppressed contacts

_Empty. Write this the first time an address is suppressed._

## Identity merges

_Empty. Write this the first time an identity needs merging._

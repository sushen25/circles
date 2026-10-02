# ADR 00XX: The consent sentence is the one user-facing string that lives in `packages/config`

_Status: proposed · 2 October 2026 · amended the same day by SUS-139_

## Context

Non-negotiable 6 says every user-facing string is a key in `src/copy`. The
sentence somebody agrees to when they ask for plan-update email is also
*recorded*: `request-email-updates` stores `CONSENT.version` against the
subscription (ADR 0019), by a server the app does not run on. The sentence
lived in two places, `packages/config/src/consent.ts` and the copy file, and
they said different things: the screen promised "one reminder. Nothing else"
and the record pointed at words naming a morning-after question the person had
never seen (the pre-release audit, finding H4, SUS-109).

## Decision

**The consent sentence lives in `packages/config/src/consent.ts` and nowhere
else, and the screen renders `CONSENT.text`.** It is the single exception to
non-negotiable 6. `{CONSENT.text}` is an expression, so the literal-string lint
needs no exception.

- **Changing the words means a new `version`**, never an edit in place and never
  in the copy file. Old subscriptions keep the version they were made under.
- **Every plan-update letter is named.** `CONSENT.covers` maps each kind that
  needs a subscription to the words in the sentence that announce it. A test ties
  the keys to the domain's table (`emailNeedsSubscription`) and to
  `SUBSCRIBER_KINDS`, so a new subscriber letter cannot ship without somebody
  reading the sentence.
- **Each version is pinned to a hash of its words** in a test, so an in-place
  edit fails.
- **A screen that calls `request-email-updates` must render the sentence**, or
  be listed as an exemption with its reason (a resend collects nothing new). A
  test scans the app and fails for an unlisted caller.
- **The version recorded is the version the person saw** (SUS-139). The client
  sends the `CONSENT.version` it rendered with the address
  (`consent_version`, required, in the `request-email-updates` contract). A tab
  opened before a deploy still shows the old words, and the record says those
  words, not the server's current ones.
- **The server accepts only versions it knows.** `CONSENT_VERSIONS` in
  `packages/config/src/consent.ts` lists every version ever shown, oldest first,
  each with its text, so any recorded version can be turned back into words
  (`consentTextFor`). It is append-only, a test pins each entry to a hash, and
  `CONSENT` must be the last entry. An unknown version is refused as
  `consent_version_unknown` (HTTP 400, naming no version) before any rate
  counter is spent; a missing one fails the contract and is a 400
  `invalid_request`. On `consent_version_unknown` the Sent screen says nothing
  was sent and reloads its copy, so the person reads the current sentence before
  agreeing to it.
- Copy that *describes* the subscription after the fact (the verified landing,
  the preferences row) lives in `src/copy` as usual, and must not promise less
  than the sentence does.

## Alternatives considered

- **Move the sentence into `src/copy` and have the server import it.** Rejected:
  the server would depend on the app's copy package, and a copy edit would
  change a legal record without a version.
- **Store the sentence with the subscription.** Rejected for now: the version
  already identifies the words and the hash pin keeps them true.

## Consequences

- Version `2026-10-02` adds the letter that asks somebody to add their times
  again after an edit (`asked_again`, ADR 0046); `2026-09-14` did not name it.
- The earlier gap, that the client did not send the version and a stale tab was
  recorded under the server's current one, is closed by SUS-139 (above). A
  consequence to keep: a version may be removed from the list only if no
  subscription holds it, which in practice means never.
- `docs/design/gen.py` carries a hand-typed mockup of the sentence; it is
  updated by hand with each version.

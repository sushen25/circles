# ADR 0006: "Continue as" reattaches a guest membership without owner approval

_Status: accepted · Date: 6 September 2026_

## Context
Session loss for anonymous web guests is the normal path (Safari's seven-day storage cap; isolated in-app browsers). The founder chose the "continue as" model over accepting duplicate members. The question is whether reattachment should need the owner's approval.

## Decision
A guest arriving with no session may pick their name from the circle's guest members (display names only, no reply state) and reattach in one tap. No owner approval. Safeguards: only memberships without a permanent identity can be reattached to; at most three reattachments per membership per seven days; the owner sees "X rejoined from a new device" and can remove a membership; an emailed re-entry token performs the same reattachment without the list. Impersonation inside a private friend group is low-risk, visible, and reversible.

## Alternatives considered
- **Owner approval** — safer in theory, but adds a blocking step at the exact moment the guest is trying to see the confirmed plan.
- **Personal links per member** — cannot be shared into a group chat.
- **Accept duplicates** — measured cost was judged too high (lost responses, owner cleanup).

## Consequences
- `reattach-member` is an Edge Function with rate limiting and an audit row.
- The continue-as list must never show reply status or email presence.

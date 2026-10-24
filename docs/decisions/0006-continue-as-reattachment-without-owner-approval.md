---
adr: 6
title: "\"Continue as\" reattaches a guest membership without owner approval"
status: accepted
date: 2026-09-06
amended_by: [78, 88, 92]
---
# ADR 0006: "Continue as" reattaches a guest membership without owner approval

_Status: accepted (the three-a-week cap is removed: [ADR 0078](0078-a-guest-may-continue-as-themselves-as-often-as-they-need.md); a signed-in account may pick a guest's name too: [ADR 0088](0088-a-signed-in-account-can-continue-as-a-guest.md); a guest is asked before a place moves: [ADR 0092](0092-a-guests-pick-from-the-list-asks-first-and-the-sent-card-says-less.md)) · Date: 6 September 2026_

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

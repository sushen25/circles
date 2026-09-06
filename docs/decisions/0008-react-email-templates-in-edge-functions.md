# ADR 0008: Render email templates with React Email inside Edge Functions

_Status: accepted · Date: 6 September 2026_

## Context
Transactional emails (verification, locked in, changed, cancelled, reminder, did it happen, organiser notifications) must match the design canvas, carry per-recipient tokens, and be testable without sending. Resend offers hosted templates, but they live outside the repository and cannot be unit-tested or diffed.

## Decision
Templates live in `supabase/functions/_shared/email/templates/*.tsx` and are rendered to HTML with React Email at send time inside `process-scheduled-jobs`. Copy comes from the shared copy package; tokens and links are injected per job. Snapshot tests render every template with fixture data and assert that no template contains a name beyond the circle's in the subject, and that every event email contains the two footer links.

## Alternatives considered
- **Resend hosted templates** — vendor lock-in, no tests, no code review.
- **Hand-written HTML strings** — brittle across email clients.

## Consequences
- Edge Function bundle size grows slightly; measured in Slice 1.
- Changing email copy is a normal PR with a snapshot diff.

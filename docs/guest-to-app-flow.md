# Guest → saved place → app: the conversion flow

_Status: proposed, for inclusion in spec v2_

_Date: 6 September 2026_

_Canvas: "Circles MVP UI", page 5 · Guest → app. Design source: `docs/design/ConversionMap.dc.html` and the seven prompt screens beside it._

## The principle

A guest who answers from a link is a complete, permanent way to use Circles, not a funnel stage. The manifesto forbids "open in app" prompts on the guest path and any prompt before the answer; the moat research says the invitation must be value, not a bounty. So conversion is designed as two separate, optional steps, each pitched only at the moment where it would just have helped:

1. **Saved place** — an account (email code, Apple or Google), still on the web. It is required to organise, because an organiser needs an identity we can find again on any device; otherwise it is optional.
2. **App installed** — pitched only on the four things a browser cannot do: a reminder before the catch-up and a push only when a decision needs the person; greying calendar clashes on-device; never rejoining; starting a circle with another group.

## The moments

| Moment | Anonymous guest | → Saved place | → App |
|---|---|---|---|
| Link tapped from the chat | Join → name → paint times → send. No prompts of any kind before the answer. | — | Installed members: the universal link opens in the app, same screen, same identity. |
| Times sent | Offer email updates for this meetup (not an account, not the app). | "Save access on every device" as a tertiary link under the email card. | — |
| Times sent **and** an email given | "Check your email" screen; the response is already in and both investments are made. | — | **Prompt: rather have these on your phone?** The app gives the same updates as a notification, one reminder, and greys clashes next time. Once per plan. |
| Returned with no session | Continue as [name], one tap, no sign-in. | **Prompt: save your place** (once, after the reattach). | Second reattach: the app sheet instead — the pain is now real. |
| Meetup locked in | Add to calendar (.ics / Google), no gate. | — | **Prompt: a nudge on the day** (one reminder, two hours before). |
| Wants to start a plan or quiet ask | — | **Gate: sign in first.** Links the existing anonymous place; nothing sent changes. No app needed. | — |
| Second response in the same circle | Same flow, no prompt on the way in. | — | **Prompt: the app sheet, once.** |
| Morning after, tapped "I was there" | — | **Prompt: start a circle for another group.** Starts the cross-circle loop. | Sign-in leads to the web app first; the app is offered inside, never before. |
| Signs in inside the app | — | — | Same email = same person; circles appear; links open in-app from then on. Push is asked only when the first reminder is due. |

## Rules every prompt obeys

- Never before the person's answer is in.
- One tap to dismiss ("Not now" / "Maybe later"), always visible, never disguised.
- At most once per moment per plan; at most one nudge per session.
- After two "not now"s on the app sheet, nothing for 30 days.
- Never inside an operational email.
- Never withholds any part of the core loop from the web.
- Members who already have the app installed (identified by linked identity) never see an app prompt.
- The email-then-app prompt and the locked-in nudge count as the same "app" ask for the once-per-plan and 30-day rules: a person who dismissed one does not see the other on the same plan.

## Copy

The prompts speak in the product's voice: specific benefit, no urgency, no guilt. The app sheet's four rows are the complete pitch; nothing else in the product sells the app. The organiser gate is worded as a practical need ("so we can find you again on any device"), not a policy.

## Spec changes implied

- §5.1: add Apple and Google sign-in beside email code for owners; add the "save your place" claim that links an anonymous membership to a new identity by circle membership, not by email match alone.
- §5.2 / §5.4: initiating a named plan or quiet ask from web requires a saved place (account). Responding never does.
- §5.7 and §5.10: add the locked-in nudge and the post-attendance "start a circle" prompt as designed surfaces with the rules above.
- §11.3 analytics: `app_nudge_shown`, `app_nudge_dismissed`, `app_nudge_tapped` (with `moment`), `account_claimed` (with `moment`), `app_first_open_linked`, `guest_started_circle`.
- §11.2 funnel: add a "Growth" row — share of installed members whose first touch was a guest link; guests who start a new circle within 30 days.
- Universal links / App Links so that, once installed, chat links open in the app with the same identity.

## What would falsify this design

If guests convert to accounts mainly at the organiser gate and almost never at the value moments, the value moments are wrongly placed or the copy is not landing. If installs come but push permission is declined at the first reminder, the reminder pitch overpromised. If the "start a circle for another group" prompt produces sign-ins but no activated circles, the cross-circle loop needs a lighter first step than creating a circle.

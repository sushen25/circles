# Store listing

What goes into App Store Connect and the Play Console when the app is first
submitted. The name and descriptor are `brand.name` and `brand.descriptor` in
`packages/config/src/brand.ts`; this page is where the longer words live until
there is an EAS Metadata file to hold them.

| Field                          | Value                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Name                           | Wenna                                                                                                                         |
| Subtitle (App Store, 30 chars) | Plans with friends                                                                                                            |
| Short description (Play)       | Plans with friends. Find a time your group is actually up for.                                                                |
| Description, first paragraph   | Find a time your group is actually up for. Friends answer from a link, calendars stay private, and a person confirms.         |
| Icon                           | `apps/app/assets/icon.png` (light), `icon-dark.png`, `icon-tinted.png`; Android adaptive layers beside them (`pnpm gen:brand`) |
| Home-screen label              | Expo `name`, which is `brand.name`: `CFBundleDisplayName` on iOS and `app_name` on Android after `expo prebuild`               |

The description's first paragraph is the brand doc's store copy
(ADR 0043). Say "catch up", "meet", "get together"; never "event".

**Check before submitting:** another app (Pinned) already uses "Plans with
friends" as its App Store subtitle. Subtitles are not unique, but confirm App
Review accepts it; if not, "Find a time with friends" is the fallback, and
`brand.descriptor` changes with it so the landing page and the store agree.

The `circles` scheme, the `app.circles.*` bundle identifiers and the `circles`
EAS slug stay as they are (ADR 0043).

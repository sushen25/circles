---
adr: 52
title: "The bare host is the website, and the app's front door on the web is `/start`"
status: proposed
date: 2026-10-03
---
# ADR 0052: The bare host is the website, and the app's front door on the web is `/start`

_Status: proposed · 3 October 2026_

## Context

`wenna.app` is the product's one host (ADR 0044) and until now its `/` was the
app's Welcome screen. The commercial site (SUS-149, the "Wenna Website"
canvas) needs a front page that reads like a page: its words are there before
anything runs, it is the same for everybody, and a chat app that unfurls the
bare host gets the site's own card.

The app cannot serve that from a route. Every route renders the neutral shell
until React has hydrated (ADR 0040), so the served HTML for a route says
"Getting things ready", which is wrong for the one page whose job is to be read
first, and poor for search and for a mobile first paint.

The founder was asked where the site lives and answered on 3 October 2026:
"wenna.app/ is the site", the ticket's recommendation.

## Decision

- **`/` is answered by the link-preview middleware** (`apps/app/app/+middleware.ts`)
  with a complete HTML document, for everybody and every user agent, on `GET`
  and `HEAD`. The document is built from the copy file, the domain's own share
  and preview templates, the tokens and the mark master
  (`apps/app/src/features/site`). It has no script, loads nothing from another
  host, and serves the fonts from `/fonts/`, copies of the files in
  `packages/tokens/assets/fonts` that `pnpm gen:brand` writes.
- **`/j/<code>`, `/p/<code>`, `/join` and every signed-in route are unchanged.**
  The preview branch of the middleware is untouched and still answers only a
  preview fetcher.
- **The app's front door on the web moves to `/start`**, the same
  `WelcomeFlow` that native opens at `/`. Every "Start a plan" on the site
  links to `/start?via=site`; the app records `site_start_plan_clicked`
  (nothing in the payload) when it opens that way. The PWA manifest's
  `start_url` is `/start`, so an installed app still lands on Welcome, which
  sends a signed-in account on to its circles.
- **A client navigation to `/` inside the app still shows Welcome**, because
  it never reaches the server. Only a full load of `/` (a typed address, a
  reload, a link) is the site. In-app code that sends someone "home" with
  `router.replace('/')` therefore keeps working, and a reload on that screen
  shows the site.

## Alternatives considered

- **A route at `/` that renders the site.** It would sit behind ADR 0040's
  shell and bring React's bundle to a page with no interaction. Rejected.
- **A static file in `public/`.** An exported `index.html` and the
  middleware's `/` would race, and the page could not read the copy file or
  the domain templates, so it could drift from the product, which the ticket
  rules out.
- **The site on another host (`www`, a subdomain).** Marketing would then link
  to a host nobody types, and ADR 0044 chose the apex for exactly that.
- **Sending the click from a script on the page.** It needs the Supabase key
  and URL in the page and a script on a page that otherwise has none. The app
  already has `track()`.

## Consequences

- The e2e specs that opened `/` as the app open `/start`.
- A change to the site's words is a change to `src/copy` (`site`); a change to
  the chat on it is a change to the domain templates. The page's test checks
  both against the templates.
- Deployed hosts cache `/` for five minutes (`public`), the only public
  caching in the middleware; it is the same for every visitor.
- Newsreader italic is not among the bundled fonts, so the canvas's italic
  words are the browser's slanted Newsreader until an italic file is added.
- Apps for iPhone and Android "are on the way" (SUS-93) on the page; remove
  the line if native slips past launch.

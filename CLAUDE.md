# Designer Job Search: notes for Claude

A local app that matches a job seeker's website visits (Google Analytics 4) to the jobs they
applied to, and finds open jobs with someone to reach out to. Read README.md first.

## Run it

- `node server.mjs` (or `npm start`): the app at http://localhost:4340/.
- `npm run demo`: made-up data at http://localhost:4341/. Google and job boards are switched off.
- `npm run demo:fresh`: an empty install, to see the first-run setup.
- `npm run screenshots`: rebuilds the demo screenshots in `docs/screenshots/` in headless Chrome.
  It leaves the five real, redacted ones alone.
- The server reads static files on each request, but changes to `server.mjs` or `lib/` need a
  restart.

`PORT`, `SA_STORE` and `SA_CONFIG` move the port and the data folders. `SA_DEMO=1` turns off every
call to Google and to job boards.

## The Mac app

`npm run app` compiles `mac/DesignerJobSearch.swift` (a WKWebView window, no Electron) into
`/Applications/Designer Job Search.app`, ad hoc signed, with `assets/AppIcon.icns` (the SDS mark).
It is a launcher: Info.plist holds `DJSAppDir` (this folder) and `DJSNode`, and the app runs the
code here, starting `server.mjs` only if nothing answers on 4340, and stopping only the server it
started. Only the app's own address shows in its window; every other link opens in the browser.
If this folder is under Documents, macOS asks once for folder access and the server waits on it.
`npm run icon` rebuilds the icon from `assets/icon.svg` (needs Chrome).

## Accessibility

`npm run a11y` runs axe-core (WCAG 2.2 A and AA) on every page, dialog and setup question, in both
themes, on demo data. It reads axe from `AXE`, defaulting to the maintainer's portfolio copy. Keep
it at zero. Dialogs close on Escape and on a background click; motion respects reduced motion.

## Helping someone install it

Follow the steps in INSTALL-WITH-CLAUDE.md. Check `node -v` (20 or later), get the code, start
`node server.mjs`, and open http://localhost:4340/. Ask before `scripts/login-item.sh install`.
The app's own first-run screens and Settings handle the rest.

Never do the Google setup for the user: do not create Google Cloud projects, service accounts or
keys, do not sign in to Google, and do not paste keys anywhere. Point them to Settings, Connect
Google Analytics, which walks through it.

## First run

A fresh install shows the setup questions (`welcomeSteps()` in `js/app.js`), one per screen. Each
answer saves to `settings` as you go (`settings.setup.at` is the current question, and
`settings.setup.google` the Google steps done), so a closed or Incognito window resumes. The last
screen sets `settings.onboarded` to true. The Google steps are shared with Settings through
`bindGoogleSetup()`.

## The legal line (Steve, 2026-10-27: "Do not create bypasses to any page I can get legally in trouble for bypassing")

- Never build a way around a block: no captcha solving, no getting past robot checks, login
  walls, rate limits, 401, 403 or 429, no rotating addresses, no posing as a browser.
- Every automatic read goes through `lib/net.mjs`: it names the app (`USER_AGENT`), honors
  robots.txt (RFC 9309), and stops at blocks. Do not add a `fetch` to a website anywhere else.
  The only robots.txt exception is an API used with the user's own key under its terms (Adzuna).
- Sites that do not let apps read them get a search link the person opens in their own browser,
  nothing more. Never automate LinkedIn, Indeed or Glassdoor.
- Credit the job sites that ask for it ("via" on each card).
- The terms of use live in `js/terms.js`; `npm run terms` copies them to TERMS.md and LICENSE.
  The first setup screen asks the person to agree, and the footer links to them on every page.

## Job boards

`js/boards.js` lists the boards the app knows and what it can do with each: `ok` (reads it on its
own), `warn` (needs something from the user, like Adzuna's free key), or `error` (the site does not
let other apps read its listings: LinkedIn, Indeed, Glassdoor, Wellfound, Built In). Each was
checked by hand on 2026-10-27; when a site changes, change its line there.

- Never scrape a site marked `error`, and never add a workaround for one. Say it cannot be checked.
  SmartRecruiters is left out of company boards because its API's robots.txt disallows apps.
  What it can have is a `search` link (built from the user's titles and places) that the person
  opens and reads themselves; its switch turns that link on Application links on or off.
- Readers live in `lib/feeds.mjs`. Remote OK and Jobicy ask to be credited, so every job from a job
  site carries `source`, and its card says "via" that site. Keep that.
- Links people add go through `getPublic()` in `lib/job.mjs` (https only, no private addresses,
  each redirect checked). `testBoard()` decides the light when a board is added.
- The Adzuna key is kept in `config/boards.json` and never sent to the page; the page only learns
  whether one is saved.

## Private data: never commit, and touch only when asked

- `store/`: the user's applications, contacts, reads, notes and settings.
- `config/`: the Google key or sign-in token.
- `demo/`: generated by the demo script; rebuild it instead of committing it.

All three are in `.gitignore`. Do not open, print or copy `store/` or `config/` unless the user
asks you to work on their own data. Even then, never print a key. Edit `store/*.json` only while
the server is stopped. Never take a screenshot of a real store yourself. The five real README
screenshots (overview, application-pull, job-matches, applications, contacts) were supplied by the
user on 2026-10-29 with people's names and pay blurred so they cannot be read back, and the browser
cropped away. Any replacement must be supplied by the user and redacted the same way before it is
committed. Every other screenshot comes from the demo.

## Rules for changes

- **Never deploy or host this app.** It holds recruiter names and job applications.
- **The app never sends messages** (LinkedIn, email or anything else). It writes notes the user
  copies and sends.
- **No dependencies, no build step.** Node standard library on the server, plain ES modules in
  the page.
- **Keep the security checks:**
  - the exact, case-sensitive `PUBLIC` allowlist in `server.mjs` (macOS ignores case in file
    names, so a deny list leaks `store/`);
  - `apiAllowed()` (Sec-Fetch-Site, Origin, the `X-Site-Analytics` header and a JSON body);
  - the Content Security Policy;
  - `esc()` on every value that came from Google Analytics or a job board, and `safeUrl()` on every
    link;
  - https only and no private addresses in `lib/job.mjs`.
- **Design system.** The page is built on SDC (`sdc.css`). Use its tokens and components (`sdc-card`,
  `.sdc-btn`, `.sdc-field`, `.sdc-pager` and so on). Pieces SDC does not have yet are local `dash-*`
  classes in `css/dash.css`, built from SDC tokens only. No raw colors, no outside UI frameworks.
  `sdc.css` is a copy: do not edit it here.
- **Type and brand.** The brand is set in type ("Designer Job Search, by Steven Design Services",
  initials DJS on the collapsed rail); there is no logo file. Headings use Nickel Gothic only when
  this computer can load it (an Adobe Fonts kit ID in `settings.fontKit`, or the font installed),
  and otherwise the bundled League Gothic in `fonts/` (SIL Open Font License, drawn at 125% to read
  like Nickel Gothic). Nickel Gothic is a paid font: never commit a kit ID or the font itself.
- **Never give a container an id that matches a view name** (`overview`, `pull`, `latest`,
  `settings` and so on). The browser jumps to it on load and the header covers it. Containers use
  `c-*` ids.
- **Scoring** lives in `js/engine.js` and is shared by the server and the page. Rejections and
  acknowledgments are automated, so they only count together with a place that fits. Outbound
  contact counts only with a place that fits. Timing alone counts only for inbound contact.
- **Demo data** in `scripts/demo.mjs` is invented: made-up people and companies, `.example`
  websites. Keep it that way.

## Writing in the app

Plain language for people who are not programmers. Say what to click, in order. No em dashes, no
contractions, American spelling. Dates show as 10.24.

## Maintainer only

`sync-sdc.mjs` copies `sdc.css` from the maintainer's design system source and only works on that
machine. Others can ignore it.

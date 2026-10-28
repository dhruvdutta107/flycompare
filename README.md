# FlyCompare — full-stack flight comparison & booking

Compare domestic flight fares across airlines, hold a fare, pay, get an e-ticket, and manage or cancel bookings.
This turns the static HCI prototype from Labs 6–8 into a deployable web app: **Node 22 + Express 5 + SQLite** backend,
a no-framework front-end styled with a compiled Tailwind build, and the same design tokens as the original prototype.

> **Simulated data.** There is no live airline feed and no real payment gateway. Flights/fares come from a deterministic
> schedule engine (`src/flights.js`) and payments go through a demo gateway (`src/payments.js`). Both are isolated so you can
> swap in Amadeus/Duffel and Razorpay/Stripe later.

## Quick start

```bash
npm install
npm run build      # compiles Tailwind CSS, self-hosts fonts, renders pages into public/
npm start          # http://localhost:3000
npm test           # 15 API/security tests (node:test)
```
Requires Node ≥ 22.13 (uses the built-in `node:sqlite`; no native modules to compile).

**Demo payment inputs** – card `4111 1111 1111 1111` (any future expiry, any 3-digit CVV) succeeds · any card ending `0002` is declined ·
ending `9995` = insufficient funds · UPI id containing `fail` is declined. Promo codes: `SUMMER40`, `NEWUSER500`, `WEEKEND750`.

## What works

| Area | Details |
|---|---|
| Search | Return / one-way / **multi-city (up to 4 legs)**, airport autocomplete (keyboard + ARIA combobox), swap button on desktop **and mobile**, travellers & cabin popover with seat rules, direct-only, recent searches, shareable result URLs |
| Results | Per-leg selection for return/multi-city, **flexible-date price strip**, filters (stops, airline, time slot, max price), 4 sort orders, seats-left warnings, connection-time checks, sticky trip bar |
| Checkout | Server-side **20-minute fare hold** with countdown, passenger forms by type (adult/child/infant age rules), live per-field validation, promo codes validated against the trip, card/UPI/net-banking with input masking and per-field errors |
| After booking | E-ticket with PNR (print/PDF via browser), My Trips (account) and **PNR + e-mail lookup** (guest), cancellation with refund calculation |
| Accounts | Register / login / logout, scrypt-hashed passwords, HttpOnly SameSite session cookie |
| Support | Contact form saves tickets to the database; FAQ, terms, privacy |
| UX | Light/dark theme, responsive, skip-link, ARIA labels, reduced-motion support, print styles |

## New in this version

| Feature | Where | How it works |
|---|---|---|
| **Live flight tracking** | `Track Flight` page, *Track* button on every e-ticket leg | `src/tracking.js` derives phase (check-in → boarding → in the air → landed), delay, gate/terminal/belt, and the aircraft's great-circle position, altitude and speed from the schedule + current time. The page polls every 15 s and the plane glides between updates on a schematic map. "In the air now" board lists flights airborne on busy routes. *Simulated* – swap `status()` for AviationStack / FlightAware / OpenSky. |
| **Cab & bus from the airport** | `Cab & Bus` page, "Getting into…" card on the e-ticket, chat | `src/transport.js`: app cabs (Mini/Sedan/SUV) with distance-based fares, demand multiplier and live-ish ETA, prepaid taxi with night charge, and indicative airport metro/bus services (Delhi Airport Express, Mumbai Metro Line 3, BMTC Vayu Vajra, TGSRTC Pushpak, Chennai Metro...) checked against your kerb time – e.g. "Not running · first at 04:45". "Book in app" opens Uber with pickup/drop filled; "Directions" opens Google Maps transit. |
| **Trip reminders** | *Trip reminders* card on the e-ticket | Web check-in (24 h), leave-for-airport (3 h) and custom reminders saved in the new `reminders` table. They fire as an in-page toast + browser notification while FlyCompare is open in any tab (logged-in users get them on every device), and **Add to calendar** downloads an `.ics` with matching alarms so the phone reminds you even when the site is closed. |
| **AI customer service** | Floating *Need help?* chat on every page | `POST /api/assistant`. The server first pulls real facts from the conversation – booking (only with **PNR + e-mail**, same rule as "Find booking"), live flight status by flight number, transfer options by airport – then answers. With `ANTHROPIC_API_KEY` set, Claude writes the reply grounded in those facts and the site policies; without a key a built-in rule engine answers the same intents. Includes suggestion chips, deep-link actions, typing indicator, and a hand-off form that creates a support ticket. |
| **Motion & HCI polish** | Everywhere | Top loading bar for every API call, scroll-reveal and staggered list entrances, animated hero route, tactile button press, header shadow on scroll, dismissible toasts with countdown bar (pause on hover), shake on invalid fields, modal pop-in, mobile menu slides in from the right, spinner on search, animated tick + confetti after payment, cross-page view transitions. All short (≤600 ms), and **all switched off under `prefers-reduced-motion`**. Dead "coming soon" nav items (Hotels, Flight + Hotel, Bus) were replaced by the two working features. |

New API routes: `GET /track/live`, `GET /track/search?number&date`, `GET /track/:flightId`, `GET /transfers?airport&time`,
`GET|POST /bookings/:token/reminders`, `DELETE /bookings/:token/reminders/:id`, `GET /bookings/:token/calendar.ics`, `GET /me/reminders`,
`POST /assistant`, `GET /assistant/info`.

## How the lab findings were addressed

| Lab 8 finding | Fix |
|---|---|
| Lighthouse performance 28 / LCP 14.7 s (runtime Tailwind CDN, render-blocking third-party fonts & scripts) | Tailwind is compiled at build time (**46 KB, ~9 KB gzipped**); fonts and icon font are self-hosted & preloaded; JS is `defer`red; assets are fingerprinted with 1-year immutable caching; gzip enabled; images lazy-loaded |
| Missing `Content-Security-Policy` / `Permissions-Policy` | Strict CSP (`script-src 'self'`, no inline scripts), plus Permissions-Policy, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, COOP/CORP, HSTS in production |
| Exposed `.git/config`, `backup.sql`, `phpinfo.php`, `server-status` | Only `public/` is served, dotfiles denied, everything else 404 (covered by an automated test) |
| Weak cookie attributes | `HttpOnly; SameSite=Lax; Secure` (when behind HTTPS) |
| No SQL-injection / XSS testing | All SQL is parameterised; all user text is HTML-escaped before rendering; JSON-only API with a CSRF header + Origin check; rate limiting on every sensitive route |
| Payment page gave only one generic error | Each field validated separately with red border + message that stays until fixed; first bad field is focused |
| Card/expiry gave no guidance while typing | Card digits grouped as you type, `/` inserted in expiry, brand detected |
| Nav "Flights" always highlighted | Active item reflects the page; booking pages show the step indicator instead |
| Swap button hidden on mobile | Mobile swap control added between the From/To fields |
| Browser-default phone error | Custom, specific messages ("A mobile number has 10 digits – you entered 8.") |

## Project layout

```
server.js              entry point (graceful shutdown)
src/app.js             Express app, routes, error handling
src/flights.js         deterministic flight/fare engine  (replace for a real supplier)
src/bookings.js        hold → passengers → promo → pay → cancel, all pricing done server-side
src/payments.js        demo payment gateway             (replace with Razorpay/Stripe)
src/offers.js          promo-code rules
src/tracking.js        simulated live flight status + position
src/transport.js       airport cabs / bus / metro options
src/assistant.js       customer-service assistant (Claude API or rule-based fallback)
src/security.js        headers/CSP, CSRF guard, rate limiter, password hashing, sessions
src/validate.js        input validation
src/db.js              SQLite schema (users, sessions, bookings, support_tickets)
web/                   page templates, JS, Tailwind input   →  `npm run build`  →  public/
tests/api.test.js      end-to-end API + security tests
```

## API (all under `/api`, JSON; non-GET requests need `X-Requested-With: fetch`)

| Method & path | Purpose |
|---|---|
| `GET /airports?q=` | autocomplete |
| `GET /flights/search?from&to&date&cabin&adults&children&infants&direct` | flights for one leg |
| `GET /flights/calendar?...` | cheapest fare for ±3 days |
| `GET /deals`, `GET /offers` | home-page deals, promo list |
| `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me` | accounts |
| `POST /bookings` | create a 20-min fare hold from flight ids (price is recomputed server-side) |
| `GET /bookings/:token` · `PUT /bookings/:token/passengers` · `POST /bookings/:token/promo` · `POST /bookings/:token/pay` · `POST /bookings/:token/cancel` | checkout & management |
| `POST /bookings/lookup` | PNR + e-mail lookup |
| `GET /me/bookings` | logged-in user's bookings |
| `POST /support` | contact form |
| `GET /healthz` | health check |

## Deploying

**Docker (any host)**
```bash
docker build -t flycompare .
docker run -p 3000:3000 -v flycompare-data:/data -e TRUST_PROXY=1 flycompare
```

**Render** – push the repo to GitHub → *New → Blueprint* → select it (`render.yaml` is included; it mounts a 1 GB disk at `/data` for SQLite).
**Railway / Fly.io / Heroku-style hosts** – they run `npm run build` then `npm start`; add a persistent volume and set `DATABASE_PATH` to it,
and set `TRUST_PROXY=1`. See `.env.example`.

SQLite lives in one file, so run **one instance** with a persistent disk. To scale out, move `src/db.js` to Postgres.

## Known limitations / next steps
* No e-mails are sent (tickets are retrievable by PNR + e-mail). Add SMTP/Resend/SES in `src/bookings.js` after `pay()`.
* Rate limits are in-memory (per instance).
* Airlines are IndiGo, Air India, Akasa Air and SpiceJet (Vistara was merged into Air India in 2024).
* Destination photos load from Unsplash; if unreachable the card falls back to a gradient.

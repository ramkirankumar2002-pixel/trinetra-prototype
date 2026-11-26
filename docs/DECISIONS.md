# Decision log

One row per decision. All rows dated 2026-11-26 come from the [build plan](BUILD_PLAN.md) (plan date). When a decision changes, **add a new row** instead of editing an old one. "Not stated in plan" means the plan gives the decision without a reason.

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-11-26 | Build one website with three role-based parts (kiosk, supervisor, store officer); no mobile app | Opens in any browser; supervisor and store officer use their phone browser |
| 2026-11-26 | Out of scope: store manager dashboard, reconciliation, billing, fraud detection engine, lab test, reports, user management, multiple sites, multiple weighbridges | Not stated in plan (master data is hardcoded and shown from PDFs) |
| 2026-11-26 | English + Hindi only; no Telugu | Not stated in plan |
| 2026-11-26 | One codebase, two programs: Next.js frontend and Node.js backend, using REST and a live WebSocket connection | Next.js hosts like Vercel cannot keep the long-lived connections the ESP32 stream and live dashboards need |
| 2026-11-26 | The backend owns the weight; the ESP32 sends it directly to the backend and the browser never sends a weight number | Nobody can fake a weight from the screen; this is Trinetra's core promise |
| 2026-11-26 | TypeScript everywhere except the ESP32 firmware (C++ in Arduino IDE 2) | One language and one set of types for the whole website |
| 2026-11-26 | Frontend: Next.js (App Router) + React, Tailwind CSS, shadcn/ui, TanStack Query, Zustand, Socket.IO client | Many pages in one site, quick big-button design, clean data loading and screen flow, instant live updates |
| 2026-11-26 | Translations in `en.json` and `hi.json` with a small `t()` helper; Noto Sans + Noto Sans Devanagari | No library needed for 2 languages; clear English and Hindi text |
| 2026-11-26 | QR codes made with `qrcode`; voice uses the Web Speech API and Fuse.js | Timeline link on slips; Web Speech is free; Fuse.js forgives small spelling errors |
| 2026-11-26 | Backend: Node.js 22 LTS, Fastify, Socket.IO, `ws` for devices, Zod, PostgreSQL 16, Drizzle ORM, pino | Stable, fast, type-safe, every request checked, clear logs |
| 2026-11-26 | Login: PIN per user hashed with bcrypt, session in a JWT cookie | Simple for a demo, still secure |
| 2026-11-26 | 5 wrong PINs lock for 1 minute; supervisor stays logged in 12 hours; kiosk is logged in once each morning | Simple but real security; the driver never logs in |
| 2026-11-26 | Image uploads handled with `@fastify/multipart` + sharp; uploads limited to 8 MB; photos viewed only through short-lived links | Photos are resized before ANPR/OCR and storage; security |
| 2026-11-26 | pnpm monorepo, ESLint + Prettier, Vitest, Playwright, local Postgres in Docker | Code structure, quality and testing |
| 2026-11-26 | Hosting: GitHub (code), Vercel (frontend), Railway (backend), Supabase (database + photo storage) | Backend must be always on; other services run on free plans (Railway Hobby is about $5 a month) |
| 2026-11-26 | Use the free Vercel and Railway addresses; no custom domain | HTTPS is automatic; a domain can be added later |
| 2026-11-26 | Next.js rewrites `/api/*` to the backend; Socket.IO connects directly with a short-lived token | The browser sees one site, so the login cookie works |
| 2026-11-26 | Only the backend holds secret keys; `.env` files and ESP32 `secrets.h` are never committed | The browser never sees secrets |
| 2026-11-26 | Hardware: load cells, position sensors, traffic lights, buzzer, display, front and back cameras; no barrier | Hardware is ready |
| 2026-11-26 | Cameras are two ESP32-CAM boards that push photos straight to the backend, not through the ESP32 | Works with a cloud backend and local hotspot; photos never slow down weight readings |
| 2026-11-26 | No live camera video on the kiosk; each photo is shown when it arrives | An HTTPS page cannot show the camera's plain-HTTP stream |
| 2026-11-26 | ANPR: Plate Recognizer (region India); Gemini reads the same photo if no plate is found | Supports Indian plates; small model plates may be missed |
| 2026-11-26 | Invoice OCR: Google Gemini (Flash, free tier); unreadable fields come back empty, never guessed | Reads photos or PDFs into JSON; use sample invoices on the free tier |
| 2026-11-26 | Invoice is uploaded from the driver's phone through a one-time QR link on the kiosk (photo or PDF, valid 10 minutes) | No invoice camera needed |
| 2026-11-26 | A demo mode can replace weight, ANPR, invoice OCR and voice; such tickets are tagged "demo" | Fallback if something fails on stage |
| 2026-11-26 | No physical printer; slips are shown on screen with a Print button | No printer needed now; Save as PDF works and any printer can be added later |
| 2026-11-26 | Voice is optional and built last (Phase 11, after Phase 16); the kiosk works fully by touch first | Every voice feature already has a touch equivalent |
| 2026-11-26 | Voice and Hindi voice review are set aside for now; Hindi screen text stays | Not stated in plan |
| 2026-11-26 | Kiosk is built for drivers first: one question per screen, big buttons, no keyboard (number pad for phone, plate keypad as last fallback) | A driver who has never used a computer must finish alone |
| 2026-11-26 | Master data (materials, unloading rules, tolerance, users, fleet, settings) is hardcoded in `packages/shared/seed/default-data.ts` | Can be changed before the demo without touching code elsewhere; no manager dashboard in scope |
| 2026-11-26 | Type 1 (always): Cement Bags, Additive, Bitumen, Steel Bars. Type 3 (always): Bricks | From the mockups; the Bricks rule is assumed |
| 2026-11-26 | Type 2 / Type 3 split by OCR invoice weight: above the threshold is Type 2 (Steel Scrap and Sand 1,000 kg; Aggregate 20 mm and 10 mm 500 kg) | From the Material Type mockup; Type 3 sample invoices must be at or below the threshold |
| 2026-11-26 | "Cement" and "Cement Bags" are one material, Cement Bags | The mockups disagree on the name |
| 2026-11-26 | Where type labels disagree, the Material Type page wins | The mockups disagree |
| 2026-11-26 | Where chainages or supervisors disagree, the unloading rule's point and supervisor are used | The mockups disagree |
| 2026-11-26 | Default unloading point is Plant, supervisor Amit Kumar | Assumed; used when there is no rule or the trip is past the range |
| 2026-11-26 | Tolerance is 0.5%; a failure puts the ticket on HOLD for the store officer, who picks measured net or invoice weight, or rejects | Business rule |
| 2026-11-26 | Stable weight: within ±10 kg for 3 seconds and ESP32 stable flag on | Only a stable weight can be captured |
| 2026-11-26 | Material mismatch goes to the store officer on the 5th attempt | Business rule |
| 2026-11-26 | Only one open ticket per plate; a front/back plate difference flags the ticket as a warning, not a block | Business rule |
| 2026-11-26 | Supervisor gets up to 3 photos, then rejects or approves as "manual check" with a note | Business rule; manual checks are marked on the timeline |
| 2026-11-26 | A duplicate invoice (same number and supplier) is a warning, not a block | Prototype scope |
| 2026-11-26 | Approval decisions cannot be changed afterwards | Not stated in plan |
| 2026-11-26 | `ticket_events` is append-only; only the backend changes ticket status | Corrections add new events; nothing is overwritten |
| 2026-11-26 | Weights stored as whole kilograms; times stored in UTC, shown in IST; ticket number `WB01-YYYYMMDD-NNNN`; plates normalised before matching | Consistent storage, display and matching |
| 2026-11-26 | Demo date is not fixed; phases are followed in order | Not stated in plan |
| 2026-11-26 | pnpm 10 (version pinned in `packageManager`), installed with `npm install -g` | Corepack is not available with Node 26; pnpm 10 is a mature release line |
| 2026-11-26 | Project targets Node 22 (`.nvmrc`, `engines` >=22.18.0, server build target `node22`) | Plan says Node 22 LTS; the development machine currently has Node 26.13.1, so Node 22 is still untested |
| 2026-11-26 | TypeScript 6.0, not 7 | typescript-eslint supports TypeScript below 6.1 only |
| 2026-11-26 | ESLint 9, not 10, with one flat config at the root (Next.js rules apply to `apps/web`) | Plugins used by `eslint-config-next` do not support ESLint 10; ESLint 9 shows a "no longer supported" warning, so upgrade when they do |
| 2026-11-26 | Only `esbuild` may run an install script (`onlyBuiltDependencies`) | pnpm blocks install scripts; esbuild is the only one that was needed |
| 2026-11-26 | LF line endings everywhere (`.gitattributes`, `.editorconfig`, Prettier) | Same files on Windows and on the Linux hosts |
| 2026-11-26 | Prettier does not format `docs/` or `CLAUDE.md` | Keeps the hand-written master plan unchanged |
| 2026-11-26 | Fonts come from `@fontsource-variable/noto-sans` and `noto-sans-devanagari`, not `next/font/google` | The kiosk must work on weak networks |
| 2026-11-26 | shadcn/ui added with the Radix base and Nova preset; its registry was reachable. Its default Geist font was removed | No fallback to hand-written components is needed; Noto fonts are the Tailwind sans font |
| 2026-11-26 | Class names are merged with shadcn's `cn` package | Installed by the current shadcn setup in place of `clsx` + `tailwind-merge` |
| 2026-11-26 | Next.js `agentRules` is off | Stops `next dev` writing `AGENTS.md`; project rules live in `CLAUDE.md` |
| 2026-11-26 | Next.js "Cache Components" and partial prefetching (turned on by the app generator) are off | Not in the plan, and the live screens do not need them yet |
| 2026-11-26 | `packages/shared` is plain TypeScript with no build step: Next transpiles it and tsup bundles it into the server | One source of truth with nothing extra to build |
| 2026-11-26 | Local database is PostgreSQL 16 installed directly on Windows, port 5433, user and password `postgres`; databases `trinetra` and `trinetra_test`. A separate PostgreSQL 17 on 5432 is left alone | Docker is not installed on the development machine. Changes the plan's "Docker Desktop running Postgres" |
| 2026-11-26 | `docker-compose.yml` (Postgres 16 on 5433) is provided but optional and untested | For anyone who uses Docker later |
| 2026-11-26 | `DATABASE_URL` and `TEST_DATABASE_URL` live in `apps/server/.env`; `.env.example` holds the local development values | They are local-only credentials. This is the exception to "`.env.example` lists names without values" |
| 2026-11-26 | `pnpm db:create` creates the databases | Works without finding `psql` |
| 2026-11-26 | Drizzle ORM 0.45 with the `postgres` driver; a hand-written SQL migration holds the no-overlap exclusion constraint (needs `btree_gist`) and the append-only trigger | Latest stable Drizzle; these two rules are not expressed in the schema file |
| 2026-11-26 | PINs are hashed with the `bcrypt` package; its install script stays blocked | Its prebuilt binary works without the script |
| 2026-11-26 | Seed data is in `packages/shared/src/seed/default-data.ts`, imported as `@trinetra/shared/seed` | Requested path (the plan says `packages/shared/seed/`); the separate import keeps demo PINs out of the browser |
| 2026-11-26 | `upload_links` table added: ticket_id, code_hash, expires_at, used_at, created_at | Described in section 7 but missing from the section 5 table list. Approved by the user |
| 2026-11-26 | Approval kinds are STORE_TYPE2, SUPERVISOR, HOLD, MISMATCH, DRIVER_HELP, PLATE_WARNING; a blocked truck is a rejected SUPERVISOR approval | Covers driver help and plate warnings. Approved by the user |
| 2026-11-26 | A plate has only one open ticket; COMPLETED, REJECTED, BLOCKED and ABANDONED are closed | Requested. Differs from rule 3, which lists BLOCKED as open: the ANPR step must check blocked tickets itself |
| 2026-11-26 | A `chainages` table holds the 10 chainages, separate from `unloading_points` | Requested; the unloading rules use points that are not in the chainage list |
| 2026-11-26 | "Plant" is two unloading points with the same code and different supervisors (Amit Kumar; Dinesh Verma for Steel Scrap) | The rules give Plant two contacts and a point has one supervisor, so code + supervisor is unique |
| 2026-11-26 | The overall default rule has no material and no trip range | One row covers every material without a rule and trips past every range |
| 2026-11-26 | A material's `type` is its type without a weight rule; materials split by weight are stored as TYPE_3 with `type2_above_kg` | Above the threshold is Type 2, otherwise Type 3 |
| 2026-11-26 | `tickets` also stores `invoice_material` and `invoice_date` | Sections 4 and 7 read them from the invoice and the mismatch check needs the material |
| 2026-11-26 | `tickets.supplier` and `tickets.transporter` are names, not links to the lists | An invoice can name one that is not in the lists |
| 2026-11-26 | `approvals.chosen_weight` stores the choice (MEASURED_NET or INVOICE_WEIGHT), not a number | The store officer picks which weight to accept; both numbers are on the ticket |
| 2026-11-26 | `photos.ticket_id` may be empty, and photo ids are random UUIDs | Plate photos are taken before a ticket starts; ids are sent to cameras and links |
| 2026-11-26 | `approvals.ticket_id` may be empty only for DRIVER_HELP | Help can be pressed before a ticket exists |
| 2026-11-26 | `users` has a unique `username` | Login is username + PIN |
| 2026-11-26 | Demo PINs: supervisors 1001-1010, store 2001, kiosk 3001. They are public in the repository, so the deployed site needs different ones | Easy to type in a local demo |
| 2026-11-26 | `wake_threshold_kg` = 500 and `scale_factor` = 1 are placeholders; `stable_band_kg` = 10 is added to settings | The plan gives no values for the first two (tune in Phase 5); 10 kg comes from rule 6 |
| 2026-11-26 | Database tests wipe and rebuild `TEST_DATABASE_URL` (name must end in `_test`) and are skipped if it is not set | They test the real migrations without touching development data |
| 2026-11-26 | Settings are checked with Zod at startup; required: DATABASE_URL, JWT_SECRET (32+ characters), FRONTEND_ORIGIN, STORAGE_DRIVER. Later-phase settings are optional; TZ defaults to Asia/Kolkata. `.env.example` now holds local values for STORAGE_DRIVER, FRONTEND_ORIGIN and TZ | A wrong setting stops the server with a clear message; secrets have no default and no value is printed |
| 2026-11-26 | `NODE_ENV` defaults to development and must be set to production when deployed | Controls the Secure cookie flag and the test routes |
| 2026-11-26 | Rate limits: 300 requests a minute per address, 20 a minute for login (kept in memory) | The plan asks for rate limiting but gives no numbers |
| 2026-11-26 | Login lock is per username and kept in memory; the 5th wrong PIN answers 429 LOCKED; unknown usernames behave like wrong PINs; attempts still being checked count too | One server only; gives no hint which usernames exist and no extra guesses from parallel requests |
| 2026-11-26 | Sessions are a 12 hour JWT in the `trinetra_session` cookie, read only from the cookie. Session and socket tokens carry a `use` field | A 60 second socket token cannot be used as a login |
| 2026-11-26 | Logout only clears the cookie; there is no server-side session list | Simple for a demo. A copied token would stay valid until it expires |
| 2026-11-26 | Uploads accept JPEG, PNG, WebP and PDF, checked by their first bytes, up to 8 MB | "Images and PDF only"; the stated type alone proves nothing. HEIC and SVG are not accepted |
| 2026-11-26 | Error answers may carry `error.details` (failing fields; seconds left when locked) | Extends the plan's `{ code, message }` format |
| 2026-11-26 | Stored files are never overwritten. Local file links are signed with a key derived from JWT_SECRET and last at most 1 hour | Photos are evidence; links must be short-lived |
| 2026-11-26 | `GET /api/health` answers 503 `degraded` if the database does not reply within 3 seconds | A host health check always gets an answer |
| 2026-11-26 | Test files run one at a time | They share and wipe the test database |
| 2026-11-26 | If a plate has a BLOCKED or REJECTED ticket in the last 24 hours, a new ticket for it starts with a PLATE_WARNING request to the store officer (to be built in Phase 8) | Closes the gap left by treating BLOCKED as closed. Requested by the user |
| 2026-11-26 | Blocked trucks (replaces the earlier "warning" row): if a plate had a BLOCKED or REJECTED ticket in the last 24 hours, a new ticket for it cannot reach the first weight until the store officer approves a PLATE_WARNING request. The kiosk says "Not approved earlier. Please go to the store office." (Phase 8) | A blocked truck must not start over. Decided by the user |
| 2026-11-26 | PLATE_WARNING now has two uses: this blocking check, and the plan's front/back plate mismatch, which only warns. Phase 8 must record which one a request is | Only the blocked-plate request may stop the first weight |
| 2026-11-26 | HEIC photos: the phone upload page converts photos to JPEG in the browser before upload; the server accepts only JPEG, PNG, WebP and PDF (Phase 8/10) | Decided by the user |
| 2026-11-26 | Phase 16: change demo usernames and PINs, set NODE_ENV=production (Secure cookies), and configure trust proxy for Railway so rate limits use the real client address | The demo logins are public; without trust proxy all users may share one rate limit. Decided by the user |
| 2026-11-26 | Business rules are pure functions in `packages/shared`; they get materials, rules and settings as arguments and never import the seed data | The website and backend use the same rules, and demo PINs stay out of the browser |
| 2026-11-26 | Plates: spaces, dashes and dots are removed; other characters are kept. A valid plate is the state format (4 digit number) or the BH series; state codes are not checked | A bad read stays visibly bad |
| 2026-11-26 | `classifyType` returns an error, not a type, when a weight rule has no whole, positive invoice weight | Never guess |
| 2026-11-26 | A first or second weight of zero or less is "weights not valid", like a net of zero or less | A weighing of zero is not a truck |
| 2026-11-26 | Variance is rounded to 2 decimals before comparing, so with 0.5% anything below 0.505% passes | Requested |
| 2026-11-26 | Stable weight: every reading is within ±10 kg of the newest one (the one captured), all flagged stable, covering a full 3 seconds with no gap over 1 second | The plan does not say what the ±10 kg is measured from; a silence proves nothing. The 1 second gap limit is new |
| 2026-11-26 | Matching answers "no match" when two materials fit or a size we do not have is named. A bare size such as "20 mm" counts only if the text says nothing else. Spelling mistakes are forgiven only in words of 4 or more letters with the same first letter (Fuse.js, score 0.3 or less) | "iron rod 20 mm" must not become stone; a wrong guess is worse than asking again |
| 2026-11-26 | Supplier and transporter matching needs the whole name, its first two or more words, or the same number of words with small mistakes | "Shree Ram Traders" must not become "Shree Ram Crushers" |
| 2026-11-26 | `parseYesNo` returns nothing for unclear answers; `parseDigits` returns nothing if any word is not understood (compound numbers such as "ninety eight" are not supported yet) | The kiosk can ask again instead of saving a wrong value |
| 2026-11-26 | The first-weight events need `plateCheck` NOT_NEEDED or APPROVED; leaving it out is refused. No new ticket status | Enforces the blocked-plate rule without a database change, and fails safely |
| 2026-11-26 | The 24 hours run from when the old ticket closed; exactly 24 hours still counts, as does an unknown closing time. Rejecting the PLATE_WARNING makes the new ticket REJECTED, which starts a new 24 hours | Follows the blocked-truck rule and fails safely |
| 2026-11-26 | Times are shown as `26 Nov 2026, 14:05 IST` (24 hour clock, English month names in both languages) | The plan only says times are shown in IST |
| 2026-11-26 | PLATE_WARNING requests have `approvals.plate_warning_reason`: BLOCKED_HISTORY (stops the first weight until the store officer approves) or FRONT_BACK_MISMATCH (warning only, never blocks). The database requires it on plate warnings and forbids it elsewhere. The existing `reason` column stays for the decision | Keeps the blocking request apart from the harmless warning. Decided by the user |
| 2026-11-26 | Phase 5 is split: 5A (backend and simulator) now, 5B (firmware, steps 42–48, ESP32-CAM firmware, step 51) later with the user's existing ESP32 code | Requested |
| 2026-11-26 | `/device` uses `@fastify/websocket`; messages are at most 4 KB; a wrong token is closed with code 1008 and a replaced connection with 4000; device tokens are optional settings but must be 16+ characters and all different | A board without a token cannot connect; the token is how a board is identified |
| 2026-11-26 | Weights are rounded to whole kilograms on arrival; readings outside ±200,000 kg are rejected | Weights are stored as whole kilograms; such a value is a fault |
| 2026-11-26 | `canCapture` checks in this order: settings loaded, ESP32 online, reading under 1 s old, above the wake threshold, position OK, stable. It returns the weight to capture | One decision for check and weight, so they cannot differ |
| 2026-11-26 | Going offline or reconnecting clears the readings; stability starts again | What the weight did during a silence is unknown |
| 2026-11-26 | `truck:left` fires when the weight falls below 80% of the wake threshold; the truck is remembered through an outage | Avoids repeated arrivals when the weight wobbles around the threshold. The 80% is new |
| 2026-11-26 | Weighbridge settings are read from the database, again every 30 s; until the first read, nothing can be captured and tare is refused | No guessed threshold; a re-seed applies without a restart |
| 2026-11-26 | Tare is refused without a reading under 1 s old, or with the weight at or above the wake threshold | Zeroing with a truck on the bridge would corrupt every later weight |
| 2026-11-26 | A retried photo request reuses the same photo id; a camera that is not connected fails at once without waiting | A slow first photo still counts; the driver is not kept waiting for an unplugged camera |
| 2026-11-26 | Camera photos are saved as received, under `photos/<UTC date>/<id>.jpg`; resizing and compression come with step 56 | Phase 7 owns the image pipeline |
| 2026-11-26 | `GET /api/kiosk/state` allows 1200 requests a minute | The general limit of 300 would block a kiosk asking several times a second |
| 2026-11-26 | The simulator is the `@trinetra/scripts` workspace package; it has an extra key `m` and `--mismatch` to send the mismatched plate pair | Gets its own type check and tests |
| 2026-11-26 | `NODE_ENV=test` also adds `POST /api/test/photos` and `POST /api/test/command` (kiosk login) | To try the hardware before the kiosk APIs exist |
| 2026-11-26 | Socket.IO shares port 4000 with `/device`. `@fastify/websocket` listens through a gate that leaves `/socket.io/` upgrades to Socket.IO | Otherwise it would answer Socket.IO's connections itself |
| 2026-11-26 | Besides CORS, the Origin of every Socket.IO connection is checked; requests without an Origin are not from a web page and still need a token | CORS does not cover WebSockets |
| 2026-11-26 | The live room is joined by connecting with `{ live: true }` and no token; a bad token is refused even with `live: true` | The only choice a browser has is the public read-only room |
| 2026-11-26 | Socket tokens carry when the login ends, and the server closes the connection then | A token is checked only when connecting |
| 2026-11-26 | Each event has a fixed list of rooms it may go to; publishing elsewhere, or to no room, is an error | Keeps private events out of the public live room; Socket.IO treats an empty room list as everyone |
| 2026-11-26 | `hw:weight` is limited to one every 200 ms; an early reading is delayed, not dropped, and none follows the news that the weighbridge is offline | A reading a moment early must not halve the update rate |
| 2026-11-26 | A kiosk or live screen is sent `hw:status` as soon as it connects | A new screen need not wait for a change |
| 2026-11-26 | `emitAfterCommit` works only inside `app.eventTransaction()` (found with AsyncLocalStorage) and throws elsewhere; nested ones are savepoints; a failure to send after a commit is logged, not thrown | Gives the requested signature without losing events silently or reporting a saved change as failed |
| 2026-11-26 | The website defaults to `http://localhost:4000` in development; a production build must set NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SOCKET_URL | Nothing to configure locally, and no silent wrong address when deployed |
| 2026-11-26 | `/dev/live` groups consecutive weights into one of its 20 rows | At 5 a second, weights would push every other event out of the list within 4 seconds |
| 2026-11-26 | Gemini is called through the Interactions API (`/v1beta/interactions`, `Api-Revision: 2026-05-20`) with `store: false` and structured JSON output | Google's current API (`generateContent` is legacy); invoices are not kept in Google's history |
| 2026-11-26 | `GEMINI_MODEL` defaults to `gemini-3.8-flash`, the newest Flash model the key lists. It answered 503 "high demand" during Phase 7; the real check used `gemini-3.5-flash-lite` for that run only | Requested: the current Flash model. `gemini-2.5-flash` is retired on 1 December 2026. The docs also list a newer non-Flash model, `gemini-4-hydrogen` |
| 2026-11-26 | Gemini retries twice when busy (after 1.5 s and 4 s) and once on a network error or its 30 s timeout; not on 429 | Rides out short spikes without spending quota on refusals |
| 2026-11-26 | Plate Recognizer lookups start at least 1.1 s apart; one retry on a network error, timeout or 429 | The free plan allows 1 lookup a second and a truck sends two photos |
| 2026-11-26 | Gemini is also asked when Plate Recognizer fails, not only when it finds no plate; the reason is reported with the result | Keeps plate reading working if one service is down |
| 2026-11-26 | From several Plate Recognizer results, one shaped like an Indian plate wins, then the higher score. A Gemini answer that is not a whole plate counts as unread. Two cameras agree on a plate only if it has a valid shape | Never guess |
| 2026-11-26 | Invoice weight units: kg, quintal, t/MT/tonne. Any other unit (bags, cubic metres, none) or more than 200,000 kg gives no weight, with a warning | Never guess; a number that large is a misread |
| 2026-11-26 | Camera photos and uploads are re-encoded (EXIF rotation applied, 1600 px, JPEG 85) and lose their metadata; the stored SHA-256 is of the saved file, not the original. Pictures over 50 megapixels are refused | Requested pipeline; removes GPS data; stops tiny files that unpack into huge images |
| 2026-11-26 | API calls are counted per UTC day in `settings` (`api_usage:<service>:<date>`). Warnings from 2,000 Plate Recognizer lookups a month and 160 Gemini requests a day | Google publishes no single free limit, so the Gemini figure is only an early warning |
| 2026-11-26 | New settings: anpr_mode, ocr_mode, demo_plate, demo_invoice. A missing mode means real; a misspelled value is an error | Demo mode must never switch on or off by accident |
| 2026-11-26 | `/dev/readers` and `/api/dev/read-*` need the kiosk login and do not exist in production | They spend API quota |
| 2026-11-26 | Tests remove both API keys and block requests to both services | Tests must never use the real APIs |
| 2026-11-26 | Phase 7 was marked done with synthetic plate images; the real plate test (9 of 10) moved to Phase 5B | No photos of the model plates yet. Requested |

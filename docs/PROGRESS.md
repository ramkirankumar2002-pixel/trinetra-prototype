# Progress

Checklist of all 17 phases and 120 steps from [section 14 of the build plan](BUILD_PLAN.md#14-step-by-step-implementation-plan). Tick a step when it is finished. A phase is finished only when its "Done when" check passes.

Build order: phases in number order, except Phase 11 (Voice, optional), which is built last, after Phase 16.

## Phase 0 — Tools, accounts and demo items

- [ ] **1.** Install **Node.js 22 LTS**; check with `node -v`.
- [ ] **2.** Turn on **pnpm** with `corepack enable`; check with `pnpm -v`.
- [ ] **3.** Install **Git**, **VS Code**, **Docker Desktop**, **Google Chrome**.
- [ ] **4.** Install **Arduino IDE 2**, the **ESP32 board package**, and the USB driver for the ESP32 board (CP210x or CH340).
- [ ] **5.** Create accounts: GitHub, Supabase, Vercel, Railway, Plate Recognizer, Google AI Studio (Gemini).
- [ ] **6.** Create the API keys (Plate Recognizer token, Gemini key) and keep them in a password manager.
- [ ] **7.** Gather demo items: number plates printed on the truck models, 3–4 printed sample invoices, front and back cameras (ready), speaker, touchscreen laptop, 2 phones, mobile hotspot.

**Done when:** every tool opens, all accounts exist, keys are saved.

## Phase 1 — Project setup

- [x] **8.** Create a private GitHub repository `trinetra-prototype` and clone it.
- [x] **9.** Create the folders above and `pnpm-workspace.yaml`.
- [x] **10.** Add root scripts: `dev`, `build`, `test`, `lint`, `db:migrate`, `db:seed`.
- [x] **11.** Add a shared strict TypeScript config.
- [x] **12.** Add ESLint, Prettier, `.editorconfig`, `.gitignore` (node_modules, `.env*`, `.next`, `dist`, `uploads`).
- [x] **13.** Add `.env.example` for server and web (section 4).
- [x] **14.** Create the Next.js app in `apps/web` (TypeScript, Tailwind, App Router) and add shadcn/ui.
- [x] **15.** Create the Fastify app in `apps/server` (run with `tsx` in development, build with `tsup`).
- [x] **16.** Create `packages/shared` and import it from both apps.
- [x] **17.** Make `pnpm dev` start both: website on port 3000, backend on port 4000.
- [x] **18.** Write the README (how to install and run) and push the first commit.

**Done when:** `localhost:3000` shows a page and `localhost:4000/api/health` answers `ok`.

✅ Passed on 2026-11-26 (run on Node 26.13.1; Node 22 not yet tested). Step 8: the repository already existed and is **public**, not private.

## Phase 2 — Database

- [x] **19.** Add `docker-compose.yml` with Postgres 16 and a data volume; start it.
- [x] **20.** Configure Drizzle with `DATABASE_URL`.
- [x] **21.** Write all tables from section 5, with enums for status and kinds.
- [x] **22.** Add indexes: unique ticket number, unique plate per vehicle, **only one open ticket per plate**.
- [x] **23.** Generate and run the first migration.
- [x] **24.** Write `default-data.ts` (materials, points, rules, users, fleet, settings).
- [x] **25.** Write the seed script (hashes PINs, can reset).
- [x] **26.** Run the seed and check the rows in Drizzle Studio.

**Done when:** all tables exist with the demo data.

✅ Passed on 2026-11-26. Step 19: PostgreSQL 16 installed on Windows (port 5433) is used instead of Docker; `docker-compose.yml` is added but untested. Step 26: rows checked with `psql` and automated tests; the Drizzle Studio server started and answered a query, but its web page was not opened.

## Phase 3 — Backend foundation

- [x] **27.** Load and check environment variables with Zod; the server refuses to start if one is missing.
- [x] **28.** Register Fastify plugins: CORS, cookie, JWT, multipart (8 MB limit), security headers, rate limiting, pino logging.
- [x] **29.** Add one error handler that always returns the standard error JSON.
- [x] **30.** Build login (PIN check + 5-try lock), logout, `me`, and socket token.
- [x] **31.** Add a role guard used by every route.
- [x] **32.** Make `/api/health` also check the database.
- [x] **33.** Build the storage service with two drivers: local folder and Supabase Storage.

**Done when:** each role can log in with an API client (Bruno or curl) and is refused on other roles' routes.

✅ Passed on 2026-11-26 with curl against the built server (`NODE_ENV=test`, development database). The Supabase storage driver is not tested until Phase 16.

## Phase 4 — Business rules (with tests)

- [x] **34.** `normalizePlate` and `formatPlate`.
- [x] **35.** `classifyType(material, invoiceKg)`.
- [x] **36.** `resolveUnloadingPoint(material, tripNo, rules)` with default point.
- [x] **37.** `computeNet` and `checkTolerance` (0.5%).
- [x] **38.** `isStable` for the 3-second window.
- [x] **39.** Voice matching helpers: aliases, yes/no words, spoken digits (in `shared`, used by the kiosk).
- [x] **40.** Ticket state machine: table of allowed moves and `transition()`, which refuses wrong moves.
- [x] **41.** Unit tests with Vitest for all of these, including edge cases: zero weight, negative net, invoice exactly at a threshold (500 / 1,000 kg), trip number past every range, plates with spaces and dashes.

**Done when:** all unit tests pass.

✅ Passed on 2026-11-26: 548 tests in `packages/shared`; coverage 100% of lines and functions (`pnpm test:coverage`).

## Phase 5 — ESP32 and hardware link

- [ ] **42.** Firmware: Wi-Fi connect with auto-reconnect.
- [ ] **43.** Read the HX711; tare on start.
- [ ] **44.** Calibrate with known weights; store the calibration factor and the truck scale factor in the firmware config.
- [ ] **45.** Stable detection on the ESP32 (moving average and small spread).
- [ ] **46.** Position sensors (e.g. one IR sensor at each end of the bridge) → position OK flag.
- [ ] **47.** Outputs: traffic light LEDs, buzzer, and the hardware display (shows text sent by the backend).
- [ ] **48.** WebSocket client to `/device` with the device token: send weight every 200 ms, heartbeat every 5 s, act on commands.
- [x] **49.** Backend `/device` endpoint: check token, keep the latest reading in memory, mark offline after 3 s, forward `hw:weight` to the kiosk about 5 times a second.
- [x] **50.** Write an ESP32 simulator script so we can develop without the model plugged in. ESP32-CAM firmware (front and back): Wi-Fi, connect to `/device` as front or back, on "snap" take a JPEG with flash and upload it over HTTPS; tune resolution and JPEG quality for plate reading; give each board a stable 5 V supply so it does not reset.
- [ ] **51.** Test the real model: weight on the bridge shows in `GET /api/kiosk/state`.

**Phase 5A (backend and simulator) done on 2026-11-26. Phase 5 is NOT finished** until 5B passes.

- Step 49: `/device`, tokens, latest reading and 3 s offline are done. Forwarding `hw:weight` to browsers comes in Phase 6 (the backend already emits it internally).
- Step 50: only the **simulator** is done. The ESP32-CAM firmware named in step 50 is listed under 5B below.

**Phase 5B** (needs the hardware and the existing ESP32 code), steps 42–48 and 51, plus:

- [ ] Real plate-reading test with ESP32-CAM photos of the model plates (target: 9 of 10 read correctly).
- [ ] ESP32-CAM firmware, front and back (the rest of step 50): Wi-Fi, connect to `/device` with its own token, say hello, heartbeat, on "snap" take a JPEG with flash and upload it; tune for plate reading; stable 5 V supply.

**Done when:** a weight placed on the model shows in the backend within half a second; lights, buzzer and display respond to commands.

## Phase 6 — Real-time events

- [x] **52.** Attach Socket.IO to the backend; accept connections only with a valid socket token.
- [x] **53.** Put each connection in its room (kiosk, supervisor:id, store, live).
- [x] **54.** Add one helper that sends events **after** the database change is saved.
- [x] **55.** Frontend hook: connect, reconnect by itself, reload data after reconnecting.

**Done when:** an event sent from the backend appears in two browser tabs at once.

✅ Passed on 2026-11-26 in the built-in browser with `pnpm dev` and the simulator: two `/dev/live` tabs showed the same events within 2 ms; the weight on screen changed 51 ms after pressing `a`; offline and back online appeared with `o`; both tabs reconnected by themselves after a backend restart.

## Phase 7 — ANPR and invoice OCR

- [x] **56.** ESP32-CAM photo request + upload endpoint, and image pipeline: resize and compress with sharp, compute SHA-256, save to storage.
- [x] **57.** Plate Recognizer client (region India), take the best plate and confidence, 8-second timeout, one retry; if it finds no plate (small model plates), ask Gemini to read the plate from the same photo.
- [x] **58.** Gemini invoice reader: send the image, ask for strict JSON, check it with Zod; unreadable fields come back empty, never guessed; convert tonnes to kg.
- [x] **59.** Demo replacements: pick a plate, pick a sample invoice.
- [x] **60.** Test with our printed plates and sample invoices; adjust camera position and lighting.

**Done when:** at least 9 of 10 plate reads are correct on our models, and all sample invoices read correctly.

✅ Software done on 2026-11-26. **The plate target has NOT been proven**: there are no photos of the model plates yet, so step 60's printed-plate test and camera adjustment moved to Phase 5B.

- Sample invoices: **4 of 4** read correctly (2 PDF, 2 JPEG), with `gemini-3.5-flash-lite`. The default `gemini-3.8-flash` answered "high demand" (503) every time that day, so it has not read anything yet.
- 10 synthetic test images (not the real test): **8 of 10** passed. Plate Recognizer misread two sharp plates (99% and 90% confidence); the hidden plate gave only its visible part. Gemini read both misread plates correctly in a follow-up.

## Phase 8 — Ticket APIs

- [x] **61.** `POST /api/anpr` (also finds an open ticket for the plate).
- [x] **62.** Start and read tickets.
- [x] **63.** Invoice upload: one-time link for the kiosk QR, and the phone upload endpoints (image or PDF up to 8 MB, 10-minute expiry) → Gemini → fields saved → kiosk told live.
- [x] **64.** Details endpoint with the mismatch counter and the 5th-attempt store request.
- [x] **65.** First weight: type rules, Type 2 hold + store request, trip number in a transaction, unloading point, supervisor request for Type 1.
- [x] **66.** Second weight: net, tolerance, HOLD request.
- [x] **67.** Discard weight and "slip printed".
- [x] **68.** Supervisor endpoints: my trucks, photo → plate read → match.
- [x] **69.** Decide endpoint: role check, status move, chosen weight or material.
- [x] **70.** Store requests list and driver-help requests.
- [x] **71.** Public timeline, live summary, demo endpoints.
- [x] **72.** A job every minute that marks old `STARTED` tickets `ABANDONED`.
- [x] **73.** Send light, buzzer and display commands: green when ready, red while weighing, orange when done, with the next instruction on the hardware display.
- [x] **74.** API tests for every endpoint: success, wrong status, wrong role.

**Also in this phase** (added 2026-11-26, not one of the 120 steps):

- [x] Close the BLOCKED gap: if a plate had a BLOCKED or REJECTED ticket in the last 24 hours, a new ticket for it cannot reach the first weight until the store officer approves a PLATE_WARNING request. The kiosk says "Not approved earlier. Please go to the store office."
- [x] Uploads: keep accepting only JPEG, PNG, WebP and PDF (HEIC photos are converted in the browser, see Phase 10).

**Done when:** a script can run a complete truck journey of each type using only API calls.

✅ Passed on 2026-11-26: `pnpm journey` ran five journeys (Type 3 automatic, Type 1 approved, fraud blocked, Type 2 approved, tolerance fail resolved) against the development database, and typecheck, lint, tests and build passed.

- The journeys use the ESP32 simulator and the demo "pick" modes: no camera, Plate Recognizer or Gemini was called. The real readers were last checked in Phase 7.
- Step 67: "discard weight" works only before a weight is saved (see the decision log).
- Not part of steps 61–74, and still not built: `GET /api/master`, `GET /api/photos/:id` (ticket answers carry short-lived photo links instead) and the kiosk's "Ready to collect" / "Not approved" lists. Phase 10 needs the first and the lists.
- Only the API is tested. No screen uses it yet.


## Phase 9 — Frontend foundation

- [x] **75.** Base layout, fonts (Noto Sans + Devanagari), Tailwind theme: colours, big sizes, kiosk and phone layouts.
- [x] **76.** Next.js rewrite so `/api/*` goes to the backend.
- [x] **77.** API client (one fetch wrapper with error messages) + TanStack Query.
- [ ] **78.** Login pages and route protection per role.
- [x] **79.** Translation files `en.json`, `hi.json` and the `t()` helper; language saved per kiosk session.
  - [ ] **The Hindi screen text needs your review** (`apps/web/src/i18n/hi.json`). It has not been checked by a Hindi speaker.
- [ ] **80.** Socket hook from phase 6 wired into the app.

**Done when:** each role can log in and sees its empty page; wrong roles are sent back to login.

## Phase 10 — Kiosk website

- [ ] **81.** Kiosk shell: top bar, bottom bar, step dots, kiosk store (current screen, ticket id, answers).
- [ ] **82.** Camera module: show the ESP32-CAM photos as they arrive, with each camera's online status.
- [ ] **83.** Screen 1 Ready, with the "Ready to collect" list.
- [ ] **84.** Screen 2 Language.
- [ ] **85.** Screen 3 Position check.
- [ ] **86.** Screen 4 Number plate (auto photo, confirm, retry, keypad fallback, open-ticket detection).
- [ ] **87.** Screen 5 Invoice upload: QR on the kiosk, the phone upload page (Take photo / Choose file, in the driver's language), live update back to the kiosk.
- [ ] **88.** Screens 6–9: one reusable question screen (big tiles) for material, supplier, transporter, phone and name; mismatch messages.
- [ ] **89.** Screen 10 Check all answers.
- [ ] **90.** Screen 11 Weighing: live weight, stability ring, confirm / weigh again.
- [ ] **91.** Screen 12 Results for Type 1/3, Type 2 and mismatch.
- [ ] **92.** Screens 13–15 second visit: status check, second weighing, final result.
- [ ] **93.** Inactivity timers, Start over, Help button.
- [ ] **94.** First and final slip layouts, QR code, Print button with print-friendly CSS.

**Also in this phase** (added 2026-11-26, not one of the 120 steps):

- [ ] Phone upload page: convert photos to JPEG in the browser before upload, so HEIC photos work.
- [ ] Kiosk: show "Not approved earlier. Please go to the store office." while a blocked-plate PLATE_WARNING waits for the store officer.

**Done when:** a full first and second visit of every type works by touch, using the ESP32 simulator.

## Phase 11 — Voice (optional, built last, after Phase 16)

- [ ] **95.** Speaking service: queue, stop on screen change, voice choice, speed.
- [ ] **96.** Write every sentence in English and Hindi; native-speaker check.
- [ ] **97.** Listening service: starts after speaking ends, 6 seconds, 5 alternatives, live caption.
- [ ] **98.** Connect matching to every question (aliases, yes/no, digits, read-back).
- [ ] **99.** Test on the kiosk computer with the USB mic in noise; record fallback audio if the Hindi voice is poor.

**Done when:** a full journey can be done by voice only, once in English and once in Hindi.

## Phase 12 — Supervisor website

- [ ] **100.** My trucks list with live updates, sound and vibration.
- [ ] **101.** Live camera component (back camera, capture, compress), shared with the store pages.
- [ ] **102.** Verify page: photos, plate match, approve / reject / manual check.
- [ ] **103.** Done list.

**Done when:** approving on a phone unlocks the kiosk in under 1 second.

## Phase 13 — Store officer website

- [ ] **104.** Requests list with tabs, type badges, live updates, sound.
- [ ] **105.** Detail page for each request type, with weight / material choice.
- [ ] **106.** Done list.

**Done when:** all five request types work end to end with the kiosk.

## Phase 14 — Shared pages

- [ ] **107.** Home page with the three role buttons.
- [ ] **108.** Ticket timeline page `/t/<ticket-no>`.
- [ ] **109.** Live summary page `/live`.
- [ ] **110.** Hidden demo settings page.

**Done when:** scanning the QR on the on-screen slip with a phone opens that ticket's timeline.

## Phase 15 — Testing

- [ ] **111.** Run all automated tests (unit, API, the four Playwright demo scenarios) until all pass.
- [ ] **112.** Run the device tests in section 15 on the real kiosk, phones and ESP32.
- [ ] **113.** Fix everything found and run both again.

**Done when:** all tests pass twice in a row.

## Phase 16 — Deploy

- [ ] **114.** **Supabase:** create the project; copy the database URL; create a private storage bucket `photos`.
- [ ] **115.** Run migrations and the seed against the Supabase database.
- [ ] **116.** **Railway:** new project from the GitHub repo, root `apps/server`, build and start commands, all backend env variables, health check `/api/health`, region closest to India (e.g. Singapore).
- [ ] **117.** **Vercel:** import the repo, root `apps/web`, env variables, rewrite `/api` to the Railway address.
- [ ] **118.** Use the free Vercel and Railway addresses (HTTPS is automatic); set `FRONTEND_ORIGIN`; check login cookies and CORS.
- [ ] **119.** Put the `wss://` backend address and device token in the ESP32 secrets and flash it; connect it to the hotspot.
- [ ] **120.** Smoke test the four demo scenarios on the deployed site with the real kiosk, two phones and the model; tag the release `v1.0-demo`. From now on, every push to `main` deploys automatically.

**Also in this phase** (added 2026-11-26, not one of the 120 steps):

- [ ] Change the demo usernames and PINs (the current ones are public in the repository).
- [ ] Set `NODE_ENV=production`, so the login cookie is `Secure`.
- [ ] Configure trust proxy for Railway, so rate limits use the real client address.

**Done when:** all four scenarios pass on the live website over the mobile hotspot.

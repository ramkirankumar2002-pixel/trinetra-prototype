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

- [ ] **34.** `normalizePlate` and `formatPlate`.
- [ ] **35.** `classifyType(material, invoiceKg)`.
- [ ] **36.** `resolveUnloadingPoint(material, tripNo, rules)` with default point.
- [ ] **37.** `computeNet` and `checkTolerance` (0.5%).
- [ ] **38.** `isStable` for the 3-second window.
- [ ] **39.** Voice matching helpers: aliases, yes/no words, spoken digits (in `shared`, used by the kiosk).
- [ ] **40.** Ticket state machine: table of allowed moves and `transition()`, which refuses wrong moves.
- [ ] **41.** Unit tests with Vitest for all of these, including edge cases: zero weight, negative net, invoice exactly at a threshold (500 / 1,000 kg), trip number past every range, plates with spaces and dashes.

**Done when:** all unit tests pass.

## Phase 5 — ESP32 and hardware link

- [ ] **42.** Firmware: Wi-Fi connect with auto-reconnect.
- [ ] **43.** Read the HX711; tare on start.
- [ ] **44.** Calibrate with known weights; store the calibration factor and the truck scale factor in the firmware config.
- [ ] **45.** Stable detection on the ESP32 (moving average and small spread).
- [ ] **46.** Position sensors (e.g. one IR sensor at each end of the bridge) → position OK flag.
- [ ] **47.** Outputs: traffic light LEDs, buzzer, and the hardware display (shows text sent by the backend).
- [ ] **48.** WebSocket client to `/device` with the device token: send weight every 200 ms, heartbeat every 5 s, act on commands.
- [ ] **49.** Backend `/device` endpoint: check token, keep the latest reading in memory, mark offline after 3 s, forward `hw:weight` to the kiosk about 5 times a second.
- [ ] **50.** Write an ESP32 simulator script so we can develop without the model plugged in. ESP32-CAM firmware (front and back): Wi-Fi, connect to `/device` as front or back, on "snap" take a JPEG with flash and upload it over HTTPS; tune resolution and JPEG quality for plate reading; give each board a stable 5 V supply so it does not reset.
- [ ] **51.** Test the real model: weight on the bridge shows in `GET /api/kiosk/state`.

**Done when:** a weight placed on the model shows in the backend within half a second; lights, buzzer and display respond to commands.

## Phase 6 — Real-time events

- [ ] **52.** Attach Socket.IO to the backend; accept connections only with a valid socket token.
- [ ] **53.** Put each connection in its room (kiosk, supervisor:id, store, live).
- [ ] **54.** Add one helper that sends events **after** the database change is saved.
- [ ] **55.** Frontend hook: connect, reconnect by itself, reload data after reconnecting.

**Done when:** an event sent from the backend appears in two browser tabs at once.

## Phase 7 — ANPR and invoice OCR

- [ ] **56.** ESP32-CAM photo request + upload endpoint, and image pipeline: resize and compress with sharp, compute SHA-256, save to storage.
- [ ] **57.** Plate Recognizer client (region India), take the best plate and confidence, 8-second timeout, one retry; if it finds no plate (small model plates), ask Gemini to read the plate from the same photo.
- [ ] **58.** Gemini invoice reader: send the image, ask for strict JSON, check it with Zod; unreadable fields come back empty, never guessed; convert tonnes to kg.
- [ ] **59.** Demo replacements: pick a plate, pick a sample invoice.
- [ ] **60.** Test with our printed plates and sample invoices; adjust camera position and lighting.

**Done when:** at least 9 of 10 plate reads are correct on our models, and all sample invoices read correctly.

## Phase 8 — Ticket APIs

- [ ] **61.** `POST /api/anpr` (also finds an open ticket for the plate).
- [ ] **62.** Start and read tickets.
- [ ] **63.** Invoice upload: one-time link for the kiosk QR, and the phone upload endpoints (image or PDF up to 8 MB, 10-minute expiry) → Gemini → fields saved → kiosk told live.
- [ ] **64.** Details endpoint with the mismatch counter and the 5th-attempt store request.
- [ ] **65.** First weight: type rules, Type 2 hold + store request, trip number in a transaction, unloading point, supervisor request for Type 1.
- [ ] **66.** Second weight: net, tolerance, HOLD request.
- [ ] **67.** Discard weight and "slip printed".
- [ ] **68.** Supervisor endpoints: my trucks, photo → plate read → match.
- [ ] **69.** Decide endpoint: role check, status move, chosen weight or material.
- [ ] **70.** Store requests list and driver-help requests.
- [ ] **71.** Public timeline, live summary, demo endpoints.
- [ ] **72.** A job every minute that marks old `STARTED` tickets `ABANDONED`.
- [ ] **73.** Send light, buzzer and display commands: green when ready, red while weighing, orange when done, with the next instruction on the hardware display.
- [ ] **74.** API tests for every endpoint: success, wrong status, wrong role.

**Also in this phase** (added 2026-11-26, not one of the 120 steps):

- [ ] Close the BLOCKED gap: if a plate has a BLOCKED or REJECTED ticket in the last 24 hours, a new ticket for it starts with a PLATE_WARNING request to the store officer.

**Done when:** a script can run a complete truck journey of each type using only API calls.

## Phase 9 — Frontend foundation

- [ ] **75.** Base layout, fonts (Noto Sans + Devanagari), Tailwind theme: colours, big sizes, kiosk and phone layouts.
- [ ] **76.** Next.js rewrite so `/api/*` goes to the backend.
- [ ] **77.** API client (one fetch wrapper with error messages) + TanStack Query.
- [ ] **78.** Login pages and route protection per role.
- [ ] **79.** Translation files `en.json`, `hi.json` and the `t()` helper; language saved per kiosk session.
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

**Done when:** all four scenarios pass on the live website over the mobile hotspot.

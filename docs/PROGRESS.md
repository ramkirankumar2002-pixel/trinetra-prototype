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

**Phase 5B** (needs the boards on the bench), steps 42–48 and 51, plus:

- [ ] Real plate-reading test with ESP32-CAM photos of the model plates (target: 9 of 10 read correctly).
- [ ] ESP32-CAM firmware, front and back (the rest of step 50): tried on both boards.
- [ ] The [first power-on checklist](HARDWARE.md#first-power-on-checklist) passes on the real boards.
- [ ] A full truck with the real model: a 200 g cargo passes, a 180 g cargo goes on HOLD.

**Software for 5B (2026-11-28): written and compiled, NOT tried on a board.** None of steps 42–48 and 51 is ticked until it works on the real weighbridge.

- [x] Main board firmware ([firmware/esp32](../firmware/esp32/esp32.ino), steps 42–48), from the offline sketch: pins, HX711 averaging, steady check, auto-zero, IR positioning and tamper detection kept.
- [x] Camera firmware ([firmware/esp32-cam](../firmware/esp32-cam/esp32-cam.ino)), one sketch for both: it pushes a frame every 1.5 s.
- [x] Both sketches compile (`arduino-cli`, ESP32 core 4.0.0): [HARDWARE.md](HARDWARE.md#compile-check).
- [x] Backend: grams to kg with "Model scale" and "Stable band" on `/settings`, tamper alarm, camera frames, both traffic lights.
- [x] Website: "Weighbridge fault" screen, store officer's alert, camera light and "last seen".
- [x] Seven 20,000 kg model bills; the simulator speaks the firmware's protocol; `pnpm fake-hardware`.
- [x] [HARDWARE.md](HARDWARE.md): wiring, libraries, flashing, `secrets.h`, hotspot, calibration, first power-on.
- [ ] The new Hindi text needs your review: [HINDI_REVIEW.md](HINDI_REVIEW.md#phase-5b).

✅ Checked on 2026-11-28 **without the boards**: typecheck, lint, format, unit and API tests, all 56 browser tests (3 new, in `hardware.spec.ts`), all six `pnpm journey` scenarios, `pnpm fake-hardware` and the build passed. Pictures of the new screens are in [screenshots/phase5b](screenshots/phase5b). The browser tests ran the website on port 3100, because another program on the computer held 3000.

After pulling this: `pnpm db:seed` (without it nothing can be weighed).

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
- [x] **78.** Login pages and route protection per role.
- [x] **79.** Translation files `en.json`, `hi.json` and the `t()` helper; language saved per kiosk session.
  - [ ] **The Hindi screen text needs your review** (`apps/web/src/i18n/hi.json`). It has not been checked by a Hindi speaker.
- [x] **80.** Socket hook from phase 6 wired into the app.

**Done when:** each role can log in and sees its empty page; wrong roles are sent back to login.

✅ Passed on 2026-11-26: Playwright (`pnpm test:e2e`, installed Google Chrome) logs in all three roles through `localhost:3000/api`, checks the cookie, the language switch, Online / "Offline — reconnecting" and the other roles' pages. Typecheck, lint, unit tests and build passed. In the built-in browser the kiosk login and page were checked at 1366×768 and the store pages at 390 px wide; a real backend restart showed Offline and then Online again.

- Not checked: a real phone or touchscreen, iPhone Safari, 1920×1080, and the Hindi text (see step 79).
- Playwright cuts the live connection itself; a real Wi-Fi drop has not been tried.
- The `/dev` pages are in English only.

## UI update — new design (before Phase 10)

Added 2026-11-26, not one of the 120 steps.

- [x] Two themes as design tokens: kiosk (dark) and dashboard.
- [x] `KioskShell` and the kiosk components.
- [x] `DashboardShell`, dashboard components, menus and dashboard homes with sample data.
- [x] The three login pages restyled.
- [x] [Style guide](design/STYLE_GUIDE.md).
- [x] Screenshots in [screenshots/ui-update](screenshots/ui-update) (`pnpm screenshots`).
  - [ ] The new Hindi text needs your review too (`apps/web/src/i18n/hi.json`).

✅ Passed on 2026-11-26: typecheck, lint, unit tests, Playwright (including the driver rules at 1366×768 and 1920×1080, and the staff pages at 390, 768 and 1440 px wide in both languages) and build. The screens were compared side by side with the references.

- Not checked: a real phone or touchscreen, iPhone Safari.
- The kiosk screens other than the login and the placeholder page are **samples** (`/dev/ui`); the real ones come in Phase 10.

## Phase 10 — Kiosk website

- [x] **81.** Kiosk shell: top bar, bottom bar, step dots, kiosk store (current screen, ticket id, answers).
- [x] **82.** Camera module: show the ESP32-CAM photos as they arrive, with each camera's online status.
- [x] **83.** Screen 1 Ready, with the "Ready to collect" list.
- [x] **84.** Screen 2 Language.
- [x] **85.** Screen 3 Position check.
- [x] **86.** Screen 4 Number plate (auto photo, confirm, retry, keypad fallback, open-ticket detection).
- [x] **87.** Screen 5 Invoice upload: QR on the kiosk, the phone upload page (Take photo / Choose file, in the driver's language), live update back to the kiosk.
- [x] **88.** Screens 6–9: one reusable question screen (big tiles) for material, supplier, transporter, phone and name; mismatch messages.
- [x] **89.** Screen 10 Check all answers.
- [x] **90.** Screen 11 Weighing: live weight, stability ring, confirm / weigh again.
- [x] **91.** Screen 12 Results for Type 1/3, Type 2 and mismatch.
- [x] **92.** Screens 13–15 second visit: status check, second weighing, final result.
- [x] **93.** Inactivity timers, Start over, Help button.
- [x] **94.** First and final slip layouts, QR code, Print button with print-friendly CSS.

**Also in this phase** (added 2026-11-26, not one of the 120 steps):

- [x] Phone upload page: convert photos to JPEG in the browser before upload, so HEIC photos work. (HEIC only where the browser can open it, as Safari does; not yet tried on an iPhone.)
- [x] Kiosk: show "Not approved earlier. Please go to the store office." while a blocked-plate PLATE_WARNING waits for the store officer.

- [x] Invoice reading made asynchronous (added 2026-11-27): the phone is answered at once.
- [x] Kiosk rail: the system name as a small two-line tag.
- [ ] The new Hindi text needs your review: [HINDI_REVIEW.md](HINDI_REVIEW.md).

**Done when:** a full first and second visit of every type works by touch, using the ESP32 simulator.

✅ Passed on 2026-11-27. Playwright drives the real screens by touch with the ESP32 simulator, both simulated cameras and the demo "pick" modes, with the driver's phone page in a second browser: Type 3 automatic, Type 1 approved, fraud blocked, Type 2 approved and tolerance fail resolved, each with both visits where there is one. Supervisor and store decisions go through the API (their screens are Phases 12 and 13). A second test file shows the fallback screens. The driver rules are checked at 1366×768 and 1920×1080 in both languages; pictures are in [screenshots/phase10](screenshots/phase10). Typecheck, lint, unit tests, `pnpm journey` and the build passed.

- Some fallback screens (a failed or slow reading, plates that differ, a visit that timed out) are shown by replacing one answer in the browser. The dialogs (Help, Start over, the staff's, and the 3-minute "Start over?") are only pictured, in English at 1366×768: the driver-rule check does not measure dialogs. The 1-minute reminder is checked there in English only.
- No real camera, Plate Recognizer or Gemini was used through the screens.
- Not checked: a real touchscreen or phone, "Take photo" with a phone camera, an iPhone HEIC photo, a real printer or the real print dialog (the paper layout was checked in Chrome's print view at 80 mm and A4).
- The QR code on a slip opens `/t/<ticket-no>`, which is built in Phase 14.


## Phase 11 — Voice (optional, built last, after Phase 16)

- [ ] **95.** Speaking service: queue, stop on screen change, voice choice, speed.
- [ ] **96.** Write every sentence in English and Hindi; native-speaker check.
- [ ] **97.** Listening service: starts after speaking ends, 6 seconds, 5 alternatives, live caption.
- [ ] **98.** Connect matching to every question (aliases, yes/no, digits, read-back).
- [ ] **99.** Test on the kiosk computer with the USB mic in noise; record fallback audio if the Hindi voice is poor.

**Done when:** a full journey can be done by voice only, once in English and once in Hindi.

## Phase 12 — Supervisor website

- [x] **100.** My trucks list with live updates, sound and vibration.
- [x] **101.** Live camera component (back camera, capture, compress), shared with the store pages.
- [x] **102.** Verify page: photos, plate match, approve / reject / manual check.
- [x] **103.** Done list.

**Also in this phase** (added 2026-11-27, not one of the 120 steps), fixes from the Phase 10 review:

- [x] `PUBLIC_WEB_URL` goes into the invoice and slip QR codes; `pnpm lan` serves the website over https on the Wi-Fi address.
- [x] Demo "pick" plate mode draws a "DEMO PHOTO" with the picked number. It no longer shows a camera's photo, which could carry another plate.
- [x] Kiosk "No phone?": the QR code and steps go; a waiting card and "I found my phone → show code again".
- [ ] The new Hindi text needs your review: [HINDI_REVIEW.md](HINDI_REVIEW.md#phase-12).

**Done when:** approving on a phone unlocks the kiosk in under 1 second.

✅ Passed on 2026-11-27 **in the browser test only**: Playwright with a 390×844 window as the phone, a pretend camera stream, the ESP32 simulator and demo "pick" plate mode. The kiosk showed the approval 110–180 ms after the tap, with everything on one computer. A Type 1 truck was weighed at the real kiosk screens, appeared on the phone by itself, was approved there, and finished its second weighing. The tests also cover one letter different, no match, reject, manual check, double tap, lost network, "Already done by someone else", login and back to the same page, another supervisor (403), a refused camera and a page without a camera. All 40 browser tests (the Phase 10 journeys among them) passed, and the `pnpm journey` scenarios: five, and since the new unloading rules a sixth, where a Steel Bars truck goes to Vikram Sharma and Amit Kumar cannot see it. Pictures are in [screenshots/phase12](screenshots/phase12). `pnpm lan` was checked from the laptop itself, through its Wi-Fi address: pages, login (a Secure cookie), live connection by polling and by WebSocket, and another website's origin refused.

- **Not tried on a real phone:** the certificate warning, the real camera, Android Chrome, iPhone Safari (including whether its live connection accepts this certificate; if not, it should keep working by polling), the sound and the vibration (iPhones have no vibration for web pages).
- No real Plate Recognizer or Gemini call was made. "Could not read" was shown by replacing one answer in the browser; the backend's handling of an unread photo is in the API tests.
- The supervisor's photo is saved without GPS: skipped for the prototype, a future feature (decided 2026-11-27).

### Testing on your phone

1. Once, after pulling this phase: `pnpm install`, then `pnpm db:migrate`.
2. Connect the laptop and the phone to the **same Wi-Fi**. A college or office Wi-Fi may stop devices from seeing each other: then use a phone hotspot.
3. Stop `pnpm dev`, then run `pnpm lan`. It prints the address to open, such as `https://192.168.1.20:3000/supervisor`. (`pnpm lan --ip <address>` if it picked the wrong network.)
4. On the phone the first time: certificate warning → **Advanced → Proceed** (iPhone: **Show Details → visit this website**).
5. On the laptop open `https://localhost:3000/kiosk` (the same warning once).

**Windows firewall:** Node.js must be allowed on **private** networks. Windows usually asks the first time: tick **Private networks**. If it did not ask, or the phone cannot connect: Windows Security → Firewall & network protection → Allow an app through firewall → **Node.js JavaScript Runtime** → tick **Private**, and make sure the Wi-Fi is set as a private network.

**One full Type 1 truck:** in a second terminal `pnpm office reset`, then `pnpm office pick sand`; in a third, `pnpm sim`. Press `a` in the simulator (loaded, 32,500 kg), confirm the plate, press **Loaded**, finish the first visit on the kiosk (material **Sand**), then press `l`. On the phone, logged in as `pankaj` (PIN 1007): **Verify → Take photo → Use this photo → Approve**. Press `e` (the same truck, empty, 12,500 kg): the kiosk offers the second weight. The supervisor's photo is read for real unless **Supervisor plate check** is on Pick on `/settings` (changed in Phase 14); on Pick it "reads" the picked plate.

### Supervisor logins (test only)

These are public in the repository. They must be changed before deploying (Phase 16). The unloading point is the one the seed's unloading rules give that supervisor.

| Username | PIN  | Name          | Unloading point                  |
| -------- | ---- | ------------- | -------------------------------- |
| amit     | 1001 | Amit Kumar    | Plant                            |
| suresh   | 1002 | Suresh Yadav  | CH-003+750 Bridge Approach Road  |
| ravi     | 1003 | Ravi Singh    | CH-005+250 Hill Section Area     |
| mahesh   | 1004 | Mahesh Patel  | CH-009+800 Near Quarry Area      |
| vikram   | 1005 | Vikram Sharma | CH-010+500 Middle Section Point  |
| dinesh   | 1006 | Dinesh Verma  | Plant (Steel Scrap)              |
| pankaj   | 1007 | Pankaj Gupta  | CH-012+300 Valley Crossing       |
| ajay     | 1008 | Ajay Kumar    | none in the rules                |
| deepak   | 1009 | Deepak Yadav  | none in the rules                |
| rohit    | 1010 | Rohit Kumar   | none in the rules                |

**Who receives trucks** (only Type 1 trucks are checked: sand and both aggregates since 2026-11-28; trips counted per material since the last demo reset):

| Material        | Trips | Supervisor to log in as | `pnpm office pick` |
| --------------- | ----- | ----------------------- | ------------------ |
| Sand            | all   | pankaj                  | `sand`             |
| Aggregate 20 mm | 1–4   | suresh                  | `aggregate`        |
| Aggregate 20 mm | 5 on  | vikram                  | `aggregate`        |
| Aggregate 10 mm | 1–3   | ravi                    | `aggregate-10`     |
| Aggregate 10 mm | 4 on  | mahesh                  | `aggregate-10`     |

The other supervisors see an empty list (Amit Kumar would get a Type 1 truck only past trip 999). After pulling this change, run `pnpm db:migrate`, then `pnpm db:seed` (without `--reset`, so tickets are kept).

**To show a truck going to another supervisor:** `pnpm office reset`, `pnpm office pick aggregate-10`, `pnpm sim`, choose **Aggregate 10 mm** on the kiosk, and log the phone in as `ravi` (PIN 1003).

## Phase 13 — Store officer website

- [x] **104.** Requests list with tabs, type badges, live updates, sound.
- [x] **105.** Detail page for each request type, with weight / material choice.
- [x] **106.** Done list (History).

**Also in this phase** (added 2026-11-27, not one of the 120 steps):

- [x] A made-up Bitumen sample bill (`BR 06 QR 4321`) and `pnpm office pick bitumen`.
- [x] Home with today's real numbers, "Trucks on site", today's history with search, and a read-only ticket page.
- [x] The server asks for a reason to accept the invoice weight or to allow a blocked plate (every rejection already needed one).
- [x] Sample data removed.
- [ ] The new Hindi text needs your review: [HINDI_REVIEW.md](HINDI_REVIEW.md#phase-13).

**Done when:** all five request types work end to end with the kiosk.

✅ Passed on 2026-11-27 **in the browser test only** (Playwright at 1366×768 and 390×844, ESP32 simulator, demo "pick" modes, one computer). Through the real weighbridge screen **and** the real store pages, on both sizes: a Type 2 truck waits and is approved (the first weight is saved); the same truck fails the tolerance and the invoice weight is accepted (the slip shows 14,500 kg); "No phone?" is answered by uploading the bill and the weighbridge goes on by itself. The store pages with trucks made through the kiosk's API: rejecting a Type 2 truck, allowing a blocked plate, fixing a mismatch, "Already handled", a supervisor's block, home numbers, trucks, history and search, and login coming back to the same page. "Seen" for front and back plates that differ is covered by API tests only (the demo mode cannot make two different plates). Pictures are in [screenshots/phase13](screenshots/phase13). All 46 browser tests, all six `pnpm journey` scenarios (the tolerance one also reads the store officer's history), typecheck, lint, unit and API tests and the build passed.

- **Not tried** on a real phone or a real laptop other than this computer: the sound, the camera for a bill, a PDF on a phone (it has an "Open the PDF" button; the in-page preview is shown on wide screens only).
- No real Gemini call was made: bills were read by the demo "pick" mode.
- A supervisor's rejection is **not** a HOLD: the ticket is BLOCKED, as before (no new state). The store officer is told by a message and sees it in History; there is nothing to approve.
- The bill reader gives no confidence figure, so none is shown.

### Waiting for a person, and cancelling (added 2026-11-27, after the Phase 13 review)

- [x] No auto-abandon while a visit waits for the store officer or the supervisor; the 10 minutes apply only to the driver's turn.
- [x] "Cancel visit" for the store officer (on a request's page, and on a truck's page from "Trucks on site"), with a reason.
- [x] Waiting times on the supervisor's pages and on "Trucks on site".
- [x] The app's preview button starts the website on 3000 and the backend on 4000.

✅ Passed on 2026-11-27: API tests for both cases (each of the six waits survives two idle days; the driver's turn still ends after 10 minutes) and for cancelling; a browser test that cancels a Type 2 truck waiting at the weighbridge screen and a truck waiting for its supervisor. All 47 browser tests, `pnpm journey`, typecheck, lint, unit and API tests and the build passed. The preview button was started once: website on 3000, backend on 4000. Overnight waits and a real phone were not tried.

To try it: make a truck wait (for example **No phone?** on the kiosk). In the store, open it from **Approvals**, or from **Trucks on site → View**, press **Cancel visit**, give a reason and confirm. The kiosk says "This visit has ended".

### Fixes after the manual-style check (2026-11-28)

[MANUAL_CHECK.md](MANUAL_CHECK.md) lists 14 issues: 11 fixed, 3 left as design choices. One more problem, found while fixing, is fixed too: the first tap on a staff home page was lost.

✅ Checked on 2026-11-28: all 48 browser tests (one of them new, for these fixes), `pnpm journey`, typecheck, lint, format, unit and API tests and the build passed. In the first full run, the laptop "No phone?" test failed once with the weighbridge still on the language screen; it passed in the next full run and was not changed. The fixed screens have not been tried on a real phone.

### Testing the store officer

**Store officer login (test only; public in the repository, change before Phase 16):** username `ram`, PIN `2001` (Ram, Sr. Manager). Page: <http://localhost:3000/store>.

The weighbridge (`wb01`, PIN `3001`) and the store can be two tabs of **one** browser: each has its own login. Three terminals: `pnpm dev`; `pnpm sim`; and one for `pnpm office`. After pulling run `pnpm db:migrate` and `pnpm db:seed` once. Tap the store page once so it may play its sound.

**A Type 2 truck, then a HOLD** (same truck):

1. `pnpm office reset`, `pnpm office pick cement`, `pnpm sim --loaded 32300` (200 kg short, so that it ends on HOLD; plain `pnpm sim` passes); press `a`.
2. Kiosk: confirm the plate, **Loaded**, upload `scripts/sample-invoices/cement.jpg` (click the QR code while developing), choose **Cement Bags**, finish the questions, take the weight. It says "Wait aside for the store officer".
3. Store: **Approvals → Open → Approve**. The first slip is under "Ready to collect" or on the screen. Press `l`.
4. Press `e` (the empty truck): confirm the plate, **Second weight**, confirm. The kiosk says the weight does not match. Press `l`.
5. Store: open the **Weight HOLD**, read the calculation, **Accept INVOICE weight**, tap a reason, confirm. The final slip is under "Ready to collect", showing 20,000 kg.

**A driver without a phone:**

1. `pnpm office reset`, `pnpm office pick cement`, `pnpm sim`; press `a`.
2. Kiosk: confirm the plate, **Loaded**, press **No phone?**.
3. Store: open **Driver help** → **Choose file** → `scripts/sample-invoices/cement.jpg` (or **Take photo**) → **Send the bill**. It says "Done" and the kiosk shows what was read.

`pnpm office approve` and `reject` still work. Do not use them while testing the store page by hand: they answer the same requests.

## Phase 14 — Shared pages

- [x] **107.** Home page with the three role buttons.
- [x] **108.** Ticket page `/t/<token>`.
- **109.** ~~Live summary page `/live`.~~ Dropped on 2026-11-28: no `/live` page and no future-features page.
- [x] **110.** Demo settings page `/settings` (store officer login).

**Also in this phase** (added 2026-11-28, not one of the 120 steps):

- [x] The slip's QR code holds an unguessable token instead of the ticket number.
- [x] The supervisor's plate check has its own demo switch (real unless switched).
- [x] DEMO badge on the weighbridge, supervisor, store and settings pages.
- [ ] The new Hindi text needs your review: [HINDI_REVIEW.md](HINDI_REVIEW.md#phase-14).

**Done when:** scanning the QR on the on-screen slip with a phone opens that ticket's page.

✅ Passed on 2026-11-28 **in the browser test only**: Playwright reads the address inside the slip's QR code at the real weighbridge screen, opens it in a second browser of 390×844 with no login, and sees the page change when the supervisor approves and after the second weighing. **No real phone has scanned a QR code.** The tests also cover the home page's three cards, wrong ticket addresses, the settings login and the supervisor being refused, each switch showing and hiding the DEMO badge on four open screens, and the reset with its typed word. All 53 browser tests, all six `pnpm journey` scenarios, typecheck, lint, format, the unit and API tests and the build passed. In the first full browser run one older test failed: it matched any "Open" link, and an earlier test leaves a help call with no ticket (which "Reset demo data" does not delete). It now opens its own truck's request. Pictures are in [screenshots/phase14](screenshots/phase14).

**Fixed afterwards (2026-11-28):** "Reset demo data" now also deletes the help calls made before a ticket existed. The browser test that sometimes stayed on the language screen (here, and once in the manual-style check below this phase's work) was a fault in the test helper: it could open the weighbridge while the previous test's truck was still driving off. The weighbridge then rightly reset when that truck had gone, undoing the tap. `arrive()` now waits for an empty bridge.

- **Not tried:** a real phone (scanning, printing or Save as PDF from the phone), a real printer. The print view was checked in Chrome's print mode at A4 width only.
- **Not seen:** the usage warning from 80% on screen (the API tests cover the figures and the warning).
- A ticket page address works for anyone who has it, and does not expire.

### Showing the demo

1. `pnpm install` (once), `pnpm db:migrate`, `pnpm db:seed`, then `pnpm dev` (for phones: `pnpm lan`).
2. Home page: <http://localhost:3000/>.
3. Demo settings: <http://localhost:3000/settings>, store officer `ram`, PIN `2001` (test only; change before Phase 16). One browser holds one login: open it in another browser or a private window than the weighbridge.
4. A ticket page: scan the QR code on a slip (a phone needs `pnpm lan`), or, while developing, copy the address from the picture's `data-url`.

## Changes after the simulator test (2026-11-28)

Not one of the 120 steps.

- [x] New material types: sand and both aggregates always Type 1; cement, steel bars, bitumen, additive and steel scrap Type 2 / Type 3 at 1,000 kg.
- [x] "Loaded / Empty" after the plate; an empty truck is weighed once and gets its own slip.
- [x] "No invoice": store officer approval before the first weight, no tolerance check.
- [x] Simulator trucks of 32,500 kg and 12,500 kg; ten sample bills that match them.
- [x] One login per app in the same browser.
- [x] After a weight the result stays until the truck leaves; no "Busy" screen.
- [ ] The new Hindi text needs your review: [HINDI_REVIEW.md](HINDI_REVIEW.md#fixes-after-the-simulator-test).

✅ Checked on 2026-11-28 with the simulator: typecheck, lint, format, the unit and API tests, all eight `pnpm journey` scenarios, all 60 browser tests and the build passed. The browser tests and journeys ran as a separate copy (its own database and ports 3100 / 4100). Pictures of the changed screens, in English and Hindi, are in [screenshots/fixes-tested](screenshots/fixes-tested). The pictures in the older screenshot folders were not retaken and show the earlier screens.

- **Not tried** on a real board, touchscreen, phone or printer.
- The 15 s return with an empty bridge is covered by the website's unit tests, not by a browser test.
- Nothing checks a driver who presses **Empty** with a loaded truck: that visit gets one weight and no approval.

After pulling this: `pnpm db:migrate`, then `pnpm db:seed`. Everyone logs in once more.

### Testing these changes with the simulator

Three terminals: `pnpm dev`, `pnpm sim`, `pnpm office`. In the simulator: `a` = loaded truck (32,500 kg), `e` = empty truck (12,500 kg), `l` = the truck leaves. Run `pnpm office reset` first.

| To see | Do |
| --- | --- |
| A Type 1 truck to its supervisor | `pnpm office pick sand`; `a`; **Loaded**; upload `sand.jpg`; **Sand**. The result says "Go to CH-012+300 – Pankaj Gupta" and stays until `l`. Approve as `pankaj`, then `e` |
| An empty truck | `pnpm office pick bricks`; `e`; confirm the plate; **Empty**; **Next**. "Please drive off"; `l` |
| No invoice | `pnpm office pick sand`; `a`; **Loaded**; **No invoice**; **Sand**; weigh. "Wait aside for the store officer"; `l`; approve in the store (pill "No invoice"), then as `pankaj`; `e` |
| Second weight without questions | After any loaded truck's first weight and approvals, press `e`: the plate leads straight to **Second weight** |
| Three logins | Open `/kiosk`, `/supervisor` and `/store` in three tabs of one browser and log in to each. Reload all three: all stay logged in |
| Back to Ready | After any weight press `l`: "Weighbridge ready — drive on" at once. An unprinted final or empty slip is under "Ready to collect" (the 15 s return is only for a result still open with the bridge empty) |

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
  - Set `BACKEND_URL` and `NEXT_PUBLIC_SOCKET_URL` before building. Then check through Vercel that an 8 MB upload works, and a slow plate reading (up to about 28 s): Vercel has its own limits for forwarded requests, which have not been tested. (Invoice reading no longer makes a request wait.)
- [ ] **118.** Use the free Vercel and Railway addresses (HTTPS is automatic); set `FRONTEND_ORIGIN`; check login cookies and CORS.
- [ ] **119.** Put the `wss://` backend address and device token in the ESP32 secrets and flash it; connect it to the hotspot.
- [ ] **120.** Smoke test the four demo scenarios on the deployed site with the real kiosk, two phones and the model; tag the release `v1.0-demo`. From now on, every push to `main` deploys automatically.

**Also in this phase** (added 2026-11-26, not one of the 120 steps):

- [ ] Change the demo usernames and PINs (the current ones are public in the repository).
- [ ] Set `NODE_ENV=production`, so the login cookie is `Secure`.
- [ ] Configure trust proxy for Railway, so rate limits use the real client address.

**Done when:** all four scenarios pass on the live website over the mobile hotspot.

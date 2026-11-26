# Trinetra Prototype — Rules for Claude

Trinetra is a smart weighbridge prototype: one website (kiosk, supervisor, store officer), one backend, and an ESP32 weighbridge model.

## First rule

Read [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) before any work. Build phase by phase in order. A phase is finished only when its "Done when" check passes.

The one exception to the order is written in the plan itself: **Phase 11 (Voice)** is optional and is built last, after Phase 16.

Related docs:

- [docs/PROGRESS.md](docs/PROGRESS.md) — tick each step as it is finished
- [docs/DECISIONS.md](docs/DECISIONS.md) — add a row for every new or changed decision

## Working rules

- Commit after every step.
- Run typecheck, lint and tests before each commit.
- **Never commit when typecheck, lint or tests fail.** Gate every commit on a check script that stops at the first failing exit code; do not rely on `set -e` or on `;` between the checks and `git commit`.
- **The backend owns the weight.** The browser never sends a weight number.
- Only the backend holds secrets.
- Never commit `.env` files or `firmware/**/secrets.h`.
- Kiosk screens must be very simple for drivers: one question per screen, big buttons, no keyboard. (The plan allows only a big number pad for the phone number, and a plate keypad as the last fallback.)

## Decisions (do not change without asking)

### Stack

- TypeScript everywhere (frontend, backend, shared code). The only exception is the ESP32 firmware (C++ in Arduino IDE 2).
- One codebase, two programs, in a **pnpm** workspaces monorepo: a frontend website and a backend server, talking through REST APIs and a live WebSocket connection.
- **Frontend:** Next.js (latest, App Router) + React, Tailwind CSS, shadcn/ui, TanStack Query, Zustand (kiosk screen flow), Socket.IO client, `en.json` + `hi.json` with a small `t()` helper, Noto Sans + Noto Sans Devanagari, Web Speech API and Fuse.js (voice), `qrcode`, browser print dialog.
- **Backend:** Node.js 22 LTS, Fastify, Socket.IO, plain WebSocket (`ws`) for ESP32 devices, Zod, PostgreSQL 16, Drizzle ORM, PIN login hashed with bcrypt with a JWT cookie (`@fastify/jwt`, `@fastify/cookie`), `@fastify/multipart` + sharp, pino.
- **Firmware libraries:** HX711 (bogde), WebSockets (links2004) over Wi-Fi with `wss://`, ArduinoJson.
- **Quality and tests:** ESLint + Prettier, Vitest (+ Fastify's request testing), Playwright for the 4 demo scenarios.
- **Local database:** PostgreSQL 16 installed directly on Windows, port **5433** (`trinetra` and `trinetra_test`). Docker is optional (`docker-compose.yml`). A separate PostgreSQL 17 uses port 5432: **leave it alone**.

### Hosting

- Code on GitHub. Frontend on **Vercel**. Backend on **Railway** (always-on Node server; needs the Hobby plan). Database and photo storage on **Supabase** (Postgres + Storage).
- Free Vercel and Railway addresses; no custom domain.
- The frontend forwards `/api/*` to the backend (Next.js rewrite). Socket.IO connects to the backend directly with a short-lived token.

### Hardware

- Load cells, position sensors, traffic lights, buzzer, a display, and front and back cameras. **No barrier.**
- **Cameras are two ESP32-CAM boards (front and back).** They connect directly to the backend, not through the ESP32, and push photos to it over HTTPS.
- The ESP32 handles only weight, sensors, lights, buzzer and display, and sends weight directly to the backend.

### Plate reading and invoices

- **ANPR: Plate Recognizer, with Gemini as fallback** (Gemini reads the plate from the same photo if Plate Recognizer finds none).
- **Invoice upload: the driver uploads from his own phone by scanning a QR code on the kiosk** (photo or PDF). **Google Gemini** (Flash model, free tier) reads it. Use sample invoices, not real company invoices.
- A demo mode can replace weight, ANPR, invoice OCR and voice on stage if something fails.

### Screens, printing and language

- **No printer.** Slips are shown on screen with a Print button (browser print dialog; Save as PDF works).
- **English + Hindi screen text.** No Telugu.
- **Voice is optional and built last.** The kiosk works fully by touch first. Voice work and the Hindi voice review are set aside for now; Hindi screen text stays.
- No mobile app. Supervisor and store officer use the website on a phone browser.

### Data and business rules

- **Master data is hardcoded** in one seed file, `packages/shared/src/seed/default-data.ts` (imported as `@trinetra/shared/seed`, never by the website; loaded with `pnpm db:seed`). Material types, unloading rules and tolerance live there. No screens to edit them.
- **Tolerance: 0.5%.** Variance % = |net − invoice weight| ÷ invoice weight × 100. Pass if ≤ 0.5%.
- **Type 2 / Type 3 split is by OCR invoice weight:** above the material's threshold → Type 2 (Store); at or below → Type 3. Thresholds: Steel Scrap 1,000 kg, Sand 1,000 kg, Aggregate 20 mm 500 kg, Aggregate 10 mm 500 kg. Cement Bags, Additive, Bitumen and Steel Bars are always Type 1 (Supervisor). Bricks are always Type 3.
- Weights are stored in kilograms as whole numbers; times are stored in UTC and shown in IST.
- `ticket_events` is append-only (a database trigger enforces it). Only the backend changes a ticket status.
- Approval kinds: STORE_TYPE2, SUPERVISOR, HOLD, MISMATCH, DRIVER_HELP, PLATE_WARNING. A blocked truck is a rejected SUPERVISOR approval.
- One open ticket per plate. Closed statuses: COMPLETED, REJECTED, BLOCKED, ABANDONED.

### Out of scope

- Store manager dashboard, reconciliation, billing, fraud detection engine, lab test, reports, Telugu, user management, multiple sites, multiple weighbridges.

### Demo date

- Not fixed. We follow the phases in order.

## Current status

Phase 7 done. Next: Phase 8, or Phase 5B (needs hardware code). Phase 5 is still open. The real plate-reading test (9 of 10 on ESP32-CAM photos of the model plates) is part of 5B and has not been run.

Business rules are pure functions in `packages/shared` (`src/rules`, `src/matching`, `src/format.ts`). Use them; do not repeat a rule in the backend or website.

Settle before the phases that need it:

- **Phase 5B:** do not tick Phase 5 until 5B passes. The firmware must follow the device protocol in the README ("Device connection"). Send a heartbeat or weight often enough: the main ESP32 is offline after 3 s of silence, a camera after 15 s.
- **Phase 8:** change data inside `app.eventTransaction()` and announce it with `emitAfterCommit()`. Event names, payloads and who may receive each are in `packages/shared/src/realtime.ts`. The "live" room needs no login: never put names, phones or plates in an event it receives.
- **Phase 8/10:** the backend keeps "truck on the bridge" in memory, so after a restart `truck:arrived` fires again for a truck already there. Events missed while disconnected are not resent: pages reload over REST (`useOnReconnect`).
- **Phase 9 (important):** the login cookie must be same-site. When adding the `/api` rewrite (step 76), make the browser call `/api/...` on the website's own address, including the socket-token request in `lib/socket.ts`. Today it calls `NEXT_PUBLIC_API_URL` directly, which works on localhost but would not send the cookie from Vercel to Railway.
- **Phase 9:** logging out does not close the live connection of other open tabs; the server ends it when the 12 hour login expires.
- **Before Phase 16:** the "live" room has no limit on how many viewers can connect.
- **Phase 8:** to capture a weight, call `app.hardware.state.canCapture()` once and save the `kg` from that same answer. Never take a weight from a request.
- **Phase 8:** a `PLATE_WARNING` needs `plateWarningReason`. Only `BLOCKED_HISTORY` goes into `plateCheck`; `FRONT_BACK_MISMATCH` never blocks.
- **Phase 8:** read plates with `app.readers.readPlates(ticketId)` (it takes the photos itself; `ticketId` null before a ticket exists, then link the photo rows to the ticket). For an uploaded invoice use `storeFile()` (kind INVOICE), then `app.readers.readInvoice(file, ticketPlate)`; it throws `ReaderError`, and the driver then uploads again or enters the values. Mark the ticket `isDemo` when a result says `demo` or source "demo".
- **Phase 8/10:** a high plate confidence is not proof (a 99% read was wrong in the Phase 7 check). The driver must always confirm the plate.
- **Gemini backup (decided):** `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`) is asked once when `GEMINI_MODEL` is busy, rate limited or times out. Results carry `model`. `gemini-3.8-flash` itself had not answered a request during Phase 7.
- **To decide:** Whether to ask Gemini for a second opinion when Plate Recognizer's read is not in the vehicle list or front and back differ.
- **Phase 8:** change status only through `transition()`. The first weight needs `plateCheck` (use `needsPlateApproval()`, then the state of that PLATE_WARNING). The state machine does not check the ticket type: pick events with `firstWeightEvent()` and `afterFirstWeightEvent()`.
- **Phase 8:** when sending a new light or display text matters after a reconnect, send it again: the backend does not repeat commands yet.
- **In Phase 8 (decided):** if a plate had a `BLOCKED` or `REJECTED` ticket in the last 24 hours, a new ticket cannot reach the first weight until the store officer approves a `PLATE_WARNING` request. The kiosk says "Not approved earlier. Please go to the store office." Keep it apart from the front/back mismatch `PLATE_WARNING`, which only warns.
- **Phase 8/10 (decided):** the phone upload page converts photos to JPEG in the browser (HEIC); the server accepts only JPEG, PNG, WebP and PDF.
- **Before Phase 8:** "Reset demo data" must delete demo tickets, but the `ticket_events` trigger refuses DELETE.
- **Before Phase 16:** change the demo usernames and PINs; they are public in the repository.
- **Before Phase 16:** set `NODE_ENV=production` on Railway (otherwise the login cookie is not `Secure`).
- **Before Phase 16:** configure Fastify's `trustProxy` safely for Railway, so rate limits use the real client address (otherwise all users may share the limits; login: 20 a minute).
- **Before Phase 16:** test the Supabase storage driver against the real bucket.

*(Update this section at the end of every phase.)*

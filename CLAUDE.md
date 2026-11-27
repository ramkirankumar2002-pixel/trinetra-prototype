# Trinetra Prototype — Rules for Claude

Trinetra is a smart weighbridge prototype: one website (kiosk, supervisor, store officer), one backend, and an ESP32 weighbridge model.

## First rule

Read [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) before any work. Build phase by phase in order. A phase is finished only when its "Done when" check passes.

The one exception to the order is written in the plan itself: **Phase 11 (Voice)** is optional and is built last, after Phase 16.

Related docs:

- [docs/PROGRESS.md](docs/PROGRESS.md) — tick each step as it is finished
- [docs/DECISIONS.md](docs/DECISIONS.md) — add a row for every new or changed decision
- [docs/design/STYLE_GUIDE.md](docs/design/STYLE_GUIDE.md) — how every screen looks. **Read it before any screen work; Phases 10–14 must follow it.**

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
- **Type 1 unloading** (added 2026-11-27): Cement Bags → Plant (Amit Kumar); Steel Bars → CH-010+500 (Vikram Sharma); Bitumen trips 1–2 → CH-003+750 (Suresh Yadav), 3 on → CH-012+300 (Pankaj Gupta); Additive → the default (Plant, Amit Kumar).
- **Tolerance: 0.5%.** Variance % = |net − invoice weight| ÷ invoice weight × 100. Pass if ≤ 0.5%.
- **Type 2 / Type 3 split is by OCR invoice weight:** above the material's threshold → Type 2 (Store); at or below → Type 3. Thresholds: Steel Scrap 1,000 kg, Sand 1,000 kg, Aggregate 20 mm 500 kg, Aggregate 10 mm 500 kg. Cement Bags, Additive, Bitumen and Steel Bars are always Type 1 (Supervisor). Bricks are always Type 3.
- Weights are stored in kilograms as whole numbers; times are stored in UTC and shown in IST.
- `ticket_events` is append-only (a database trigger enforces it; the one exception is "Reset demo data" deleting the rows of demo tickets). Only the backend changes a ticket status.
- Approval kinds: STORE_TYPE2, SUPERVISOR, HOLD, MISMATCH, DRIVER_HELP, PLATE_WARNING. A blocked truck is a rejected SUPERVISOR approval.
- One open ticket per plate. Closed statuses: COMPLETED, REJECTED, BLOCKED, ABANDONED.

### Out of scope

- Store manager dashboard, reconciliation, billing, fraud detection engine, lab test, reports, Telugu, user management, multiple sites, multiple weighbridges.

### Demo date

- Not fixed. We follow the phases in order.

## Current status

Phase 13 done (the store officer website), with a Bitumen sample bill. Next: Phase 14 (shared pages), or Phase 5B (needs hardware code). Phase 5 is still open. The real plate-reading test (9 of 10 on ESP32-CAM photos of the model plates) is part of 5B and has not been run. **Nothing has been tried on a real touchscreen, phone or printer** (the "Done when" of Phases 12 and 13 passed in the browser tests only). The Hindi text is unchecked ([docs/HINDI_REVIEW.md](docs/HINDI_REVIEW.md)). To try the store officer: [docs/PROGRESS.md](docs/PROGRESS.md#testing-the-store-officer); on a phone: [docs/PROGRESS.md](docs/PROGRESS.md#testing-on-your-phone).

Business rules are pure functions in `packages/shared` (`src/rules`, `src/matching`, `src/format.ts`). Use them; do not repeat a rule in the backend or website. The ticket API's request schemas and answer types are in `src/tickets.ts`.

Backend rules to keep: change a status only through `changeStatus()` (`apps/server/src/tickets/repo.ts`) inside `app.eventTransaction()`; lock the ticket before the approval or the material; a weight comes only from one `canCapture()` answer. No request may take longer than 30 s (the website's forwarding limit): slow work goes to `app.background`, as invoice reading does. `pnpm journey` runs the six scenarios (it runs "Reset demo data" first).

Website rules to keep: call the backend only through `api` (`apps/web/src/lib/api.ts`), on the website's own `/api` (never the backend's address; only Socket.IO connects there; the phone's file upload in `lib/upload/send-file.ts` uses XHR for its progress figure). Every screen text goes in both `src/i18n/en.json` and `hi.json` and is read with `useT()`; add new Hindi to the review note. Staff pages go under `src/app/<role>/(signed-in)/`, are framed by `RoleShell` and listed in `src/lib/menus.ts`.

Kiosk rules to keep: `/kiosk` is one page (`components/kiosk/kiosk-app.tsx`). `lib/kiosk/flow.ts` decides the screen from the ticket's status plus the driver's step; every driver screen is a `KioskFrame`. A press that saves goes through `useAction()` (one at a time, same Idempotency-Key on retry). After any `await`, check the kiosk has not moved on (`sameDriver()`, or `answered(from)`): the truck may have left.

Supervisor rules to keep: the supervisor's pages are `app/supervisor/(signed-in)/` (data in `lib/supervisor/queries.ts`, keys start with `SUPERVISOR_KEY`); `TruckWatcher` in `RoleShell` does live reloading, the sound and the tab title. Staff take photos only with `components/camera/live-camera.tsx` (reuse it for the store pages). The backend judges every photo (`comparePlates`) and refuses an approval without one. Buttons are at least 48 px. `pnpm test:e2e` includes `supervisor.spec.ts`; `PHASE12_SHOTS=1` retakes `docs/screenshots/phase12` (then `pnpm -C scripts run compress-screenshots ../docs/screenshots/phase12`).

**Phases 11–14 must follow [docs/design/STYLE_GUIDE.md](docs/design/STYLE_GUIDE.md):** two themes (token colour names only), the shared components (`/dev/ui` shows them), status = colour + icon + word, and the driver rules. Every new kiosk screen is checked with `look()` (`tests/e2e/kiosk-world.ts`) at 1366×768 and 1920×1080 in both languages with its longest message showing, and its picture is looked at. `pnpm test:e2e` runs the browser tests (installed Chrome, development database, demo reset); `pnpm screenshots:kiosk` retakes `docs/screenshots/phase10`. The design reference images and side-by-side comparisons are on this computer only: do not commit them (public repository) unless the user says so. `pnpm office` can make the store officer's and the supervisors' decisions without their pages.

Store officer rules to keep: pages are `app/store/(signed-in)/` (data in `lib/store/queries.ts`, keys start with `STORE_KEY`; wording and sums in `lib/store/logic.ts`); `StoreWatcher` in `RoleShell` does live reloading, sound, messages and the tab title. Every store route uses `requireRole("STORE")`. The server, not only the page, requires a reason to reject, to accept the invoice weight and to allow a blocked plate. A refusal `WRONG_STAGE` or `ALREADY_DECIDED` shows "Already handled" and returns to the list. A visit waiting for a person (`waitsForPerson()` in shared) is never auto-abandoned; use that rule, not the status alone. The store officer's "Cancel visit" (`tickets/cancel.ts`) ends it as ABANDONED with a `STORE_CANCELLED` event. `store.spec.ts` covers both sizes; `PHASE13_SHOTS=1` retakes `docs/screenshots/phase13` (then compress). `lookAt()` (`tests/e2e/staff-look.ts`) checks every staff screen.

Settle before the phases that need it:

- **Phase 5B:** do not tick Phase 5 until 5B passes. The firmware must follow the device protocol in the README ("Device connection"). Send a heartbeat or weight often enough: the main ESP32 is offline after 3 s of silence, a camera after 15 s.
- **Open:** the backend keeps "truck on the bridge" and the plate reads in memory, so after a restart `truck:arrived` fires again (safe: it creates nothing) and the plate must be read again. Events missed while disconnected are not resent: pages reload over REST (`useOnReconnect`).
- **Open:** logging out does not close the live connection of other open tabs; the server ends it when the 12 hour login expires. (Such a tab goes to the login when it next gets focus.)
- **Open:** the kiosk's dialogs are not measured by the driver-rule check.
- **Open:** "Reset demo data" does not delete help calls made before a ticket existed.
- **To decide:** a visit that waits for a person now stays open until someone answers or cancels it, also overnight. While it is open, its plate cannot start a new ticket (the old one is carried on).
- **To decide:** cancelling does not block the plate (Reject does). Check that this is wanted for a truck waiting for its supervisor or on HOLD.
- **To decide:** should a supervisor's rejection become something the store officer can overrule? Today it is BLOCKED and for information only.
- **To try with a real phone (Phase 13):** the camera for a bill, opening a PDF bill, the sound.
- **To try with a real phone (Phase 12):** certificate warning, camera on Android Chrome and iPhone Safari, the live connection on iPhone with the self-signed certificate, sound and vibration.
- **Decided:** the supervisor's GPS is skipped in the prototype (a future feature).
- **Phase 14:** build `/t/<ticket-no>` (the slips' QR codes point to it) and the demo settings behind the 3 second logo hold (it offers only "Log out" now).
- **To try with a real phone:** the QR codes hold `PUBLIC_WEB_URL` (`pnpm lan` sets it). Test "Take photo" and an iPhone HEIC photo.
- **A high plate confidence is not proof** (a 99% read was wrong in the Phase 7 check): the driver always confirms the plate.
- **Gemini backup (decided):** `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`) is asked once when `GEMINI_MODEL` is busy, rate limited or times out. Results carry `model`. `gemini-3.8-flash` itself had not answered a request during Phase 7.
- **To decide:** Whether to ask Gemini for a second opinion when Plate Recognizer's read is not in the vehicle list or front and back differ.
- **To decide:** ticket numbers can be guessed, so anyone can open another ticket's public timeline (`/t/<ticket-no>`).
- **Before Phase 16:** change the demo usernames and PINs; they are public in the repository.
- **Before Phase 16:** set a new `ADMIN_PIN` on Railway.
- **Before Phase 16:** set `NODE_ENV=production` on Railway (otherwise the login cookie is not `Secure`).
- **Before Phase 16:** configure Fastify's `trustProxy` safely for Railway, so rate limits use the real client address (otherwise all users may share the limits; login: 20 a minute, phone upload: 30 a minute). With the rewrite, it must cover both hops.
- **Before Phase 16:** test the Supabase storage driver against the real bucket.
- **Before Phase 16:** set `PUBLIC_WEB_URL` on Railway and Vercel to the website's address. The demo "pick" photo is drawn with a system font: check its text on Railway (Linux).
- **Before Phase 16:** set `BACKEND_URL` on Vercel, and test an 8 MB upload and a slow plate reading (up to about 28 s) through Vercel's forwarding.
- **Before Phase 16:** the "live" room has no limit on how many viewers can connect.

*(Update this section at the end of every phase.)*

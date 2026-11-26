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
- **Quality and tests:** ESLint + Prettier, Vitest (+ Fastify's request testing), Playwright for the 4 demo scenarios, Docker Desktop for local Postgres.

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

- **Master data is hardcoded** in one seed file, `packages/shared/seed/default-data.ts` (loaded with `pnpm db:seed`). Material types, unloading rules and tolerance live there. No screens to edit them.
- **Tolerance: 0.5%.** Variance % = |net − invoice weight| ÷ invoice weight × 100. Pass if ≤ 0.5%.
- **Type 2 / Type 3 split is by OCR invoice weight:** above the material's threshold → Type 2 (Store); at or below → Type 3. Thresholds: Steel Scrap 1,000 kg, Sand 1,000 kg, Aggregate 20 mm 500 kg, Aggregate 10 mm 500 kg. Cement Bags, Additive, Bitumen and Steel Bars are always Type 1 (Supervisor). Bricks are always Type 3.
- Weights are stored in kilograms as whole numbers; times are stored in UTC and shown in IST.
- `ticket_events` is append-only. Only the backend changes a ticket status.

### Out of scope

- Store manager dashboard, reconciliation, billing, fraud detection engine, lab test, reports, Telugu, user management, multiple sites, multiple weighbridges.

### Demo date

- Not fixed. We follow the phases in order.

## Current status

Phase 1 done. Next: Phase 2.

*(Update this section at the end of every phase.)*

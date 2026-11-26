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

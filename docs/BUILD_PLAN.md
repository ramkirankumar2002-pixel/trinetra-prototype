# Trinetra Prototype — Build Plan (Website)

Plan date: 26 Nov 2026. Source of truth for building this project. Section 3 originally had an architecture diagram; its content is described in the text below it.

## 1. Overview

We will build the Trinetra funding prototype from scratch with Claude, as **one website** that opens in any browser. It has three role-based parts — Weighbridge kiosk, Supervisor, Store officer — all live-connected to one backend and to our ESP32 weighbridge model. No mobile app is installed anywhere; the supervisor and store officer open the website on their phone browser.

### What we build

| Part | Who uses it | Device | Address (example) |
| --- | --- | --- | --- |
| Weighbridge kiosk | Driver, alone | Touchscreen laptop/PC beside the model, with speaker; no printer (slips shown on screen with a Print button); invoices come from the driver's phone | `/kiosk` |
| Supervisor dashboard | Site supervisor | Phone browser | `/supervisor` |
| Store officer dashboard | Store officer | Phone browser | `/store` |
| Ticket page (QR page) | Anyone with the slip, investors | Phone browser | `/t/<token>` |
| Home page | Anyone | Any browser | `/` |
| Demo settings | Us, during the pitch (store officer login) | Any browser | `/settings` |

There is **no** live summary screen (`/live`) and **no** future-features page (decided 2026-11-28).

### What we do not build

- Store manager dashboard (master data is hardcoded; shown from PDFs)
- Reconciliation, billing, fraud detection engine, lab test, reports
- Telugu (only English + Hindi)
- User management, multiple sites, multiple weighbridges

### Key decisions

1. **One codebase, two programs:** a frontend website (Next.js) and a backend server (Node.js). They talk through REST APIs and a live WebSocket connection.
2. **The backend owns the weight.** The ESP32 sends weight directly to the backend, never through the browser, so nobody can fake a weight from the screen. This is Trinetra's core promise.
3. **Real ANPR and real invoice OCR (Gemini); voice is added last as an optional phase, the kiosk works fully by touch first** — with a demo mode that can replace each one on stage if it fails.
4. **The kiosk is built for drivers first:** one question per screen, big buttons, everything spoken in the chosen language, voice or touch for every answer.
5. **Material types, unloading rules and tolerance live in one seed file**, so we can change them before the demo without touching code.

**Hardware (ready):** load cells, position sensors, traffic lights, buzzer, a display, and two ESP32-CAM cameras (front and back). There is no barrier. The cameras connect to the website/backend directly, not through the ESP32.

## 2. Tech stack

TypeScript everywhere (frontend, backend, shared code), so one language and one set of types covers the whole website. The ESP32 firmware is the only non-TypeScript part (C++ in Arduino).

### Frontend (what runs in the browser)

| Need | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js** (latest, App Router) + **React** | One site with many pages (`/kiosk`, `/supervisor`, `/store`); fast; easy to deploy |
| Styling | **Tailwind CSS** | Quick, consistent large-button kiosk design |
| Ready UI parts | **shadcn/ui** | Buttons, dialogs, lists we can fully restyle |
| Server data in pages | **TanStack Query** | Loads and refreshes lists (pending trucks, requests) cleanly |
| Kiosk screen flow | **Zustand** store with a fixed list of steps | Keeps "which screen, what answers so far" in one place |
| Live updates | **Socket.IO client** | Receives weight, approvals, new requests instantly |
| Translations | Two files: `en.json`, `hi.json` + a small `t()` helper | No library needed for 2 languages |
| Fonts | **Noto Sans** + **Noto Sans Devanagari** | Clear English and Hindi text |
| Voice | Browser **Web Speech API** | Free; speech-to-text and text-to-speech in Chrome, English and Hindi (added last, optional) |
| Matching spoken words | **Fuse.js** | "bees mm" → 20 mm Aggregate, small spelling errors forgiven |
| QR code on slip | **qrcode** | Makes the QR image for the timeline link |
| Printing | A Print button that opens the browser print dialog | No printer needed now (Save as PDF works); any printer later |

### Backend (the server)

| Need | Choice | Why |
| --- | --- | --- |
| Runtime | **Node.js 22 LTS** | Stable, same language as frontend |
| Web framework | **Fastify** | Fast, simple, built-in validation |
| Real-time | **Socket.IO** | Live two-way connection to all screens |
| ESP32 connection | Plain **WebSocket** endpoint (`ws` library) | ESP32 has a good WebSocket client; light and fast |
| Input checking | **Zod** | Every request is checked; same schemas shared with frontend |
| Database | **PostgreSQL 16** | Reliable; good for tickets and logs |
| Database code | **Drizzle ORM** | Type-safe queries, simple migrations |
| Login | PIN per user, hashed with **bcrypt**, session in a **JWT cookie** (`@fastify/jwt`, `@fastify/cookie`) | Simple for a demo, still secure |
| Image upload | `@fastify/multipart` + **sharp** | Receives camera photos, resizes them before ANPR/OCR and storage |
| Logs | **pino** | Clear server logs for debugging |

### Why two programs and not one

Next.js alone could serve APIs, but Next.js hosts (like Vercel) cannot keep long-lived connections open. We need always-open connections for the ESP32 weight stream and live dashboards. So the frontend runs on Vercel and a separate always-on Node server runs the APIs and WebSockets.

### Hardware (ESP32)

| Need | Choice |
| --- | --- |
| Language / IDE | C++ in **Arduino IDE 2** (ESP32 board package) |
| Load cell amplifier | **HX711** library (bogde) |
| Talk to backend | **WebSockets** library (links2004) over Wi-Fi, secure `wss://` |
| Message format | **ArduinoJson** |

### Tools, testing and hosting

| Need | Choice |
| --- | --- |
| Code structure | **pnpm** workspaces monorepo |
| Code quality | ESLint + Prettier |
| Unit and API tests | **Vitest** (+ Fastify's built-in request testing) |
| End-to-end tests | **Playwright** (runs the 4 demo scenarios in a real browser) |
| Local database | **Docker Desktop** running Postgres |
| Code hosting | **GitHub** |
| Frontend hosting | **Vercel** |
| Backend hosting | **Railway** (always-on Node server) |
| Database + photo storage in the cloud | **Supabase** (Postgres + Storage) |

## 3. Architecture: how everything connects

The browser never talks to the database, the ESP32 or the outside APIs directly. Everything goes through our backend, which checks every request and decides every step.

*\[embedded content: system architecture · browsers, backend, database, APIs, ESP32\]*

### The five connections, in plain words

1. **Browser → Frontend (Vercel):** when you open `/kiosk` or `/supervisor`, Vercel sends the page (HTML, JavaScript, CSS). After that, the page runs in the browser.
2. **Browser → Backend, REST API (HTTPS):** for actions that happen once — log in, upload a plate photo, save the material, approve a ticket. The page sends a request like `POST /api/tickets/123/approve` and gets a JSON answer back.
3. **Browser ↔ Backend, live events (Socket.IO over WSS):** a connection that stays open. The backend pushes news the moment it happens — live weight to the kiosk, a new truck to the supervisor's phone, "approved" back to the kiosk. No page refresh, under 1 second.
4. **ESP32 ↔ Backend (WebSocket over Wi-Fi):** the ESP32 sends weight about 5 times a second, plus position and stable flags. The backend sends back commands: traffic light colour, buzzer, text on the hardware display.
5. **Backend → Supabase and outside APIs:** the backend saves tickets in Postgres and photos in Supabase Storage. It sends plate photos to Plate Recognizer and invoice photos to the Gemini API, and gets text back.

**Cameras connect without the ESP32.** They are ESP32-CAM boards with their own Wi-Fi. Each keeps its own connection to the backend; when a truck arrives the backend sends "take photo" and the ESP32-CAM uploads the JPEG straight to the backend over HTTPS. This works even though the backend is in the cloud and the cameras sit on the local hotspot (the backend could not reach them the other way round). The ESP32 only handles weight, sensors, lights, buzzer and display, so photos never slow down the weight readings. The front and back cameras read both number plates. Invoices need no camera: the driver uploads them from his own phone by scanning a QR code on the kiosk (section 8).

### One example: a Type 1 truck, start to end

1. ESP32 reports weight rising and position OK → backend tells the kiosk "truck on bridge" → kiosk wakes up.
2. Front and back cameras take plate photos → `POST /api/anpr` → backend asks Plate Recognizer → returns "MH12AB1234".
3. Driver answers questions by tapping (voice comes later); kiosk sends answers with REST calls.
4. Weight stable → kiosk asks `POST /api/tickets/:id/first-weight` → backend takes the weight **it** received from the ESP32 (not from the browser) and saves it.
5. Backend finds the unloading point and supervisor, then pushes `ticket:new` to that supervisor's phone.
6. Supervisor takes a live photo → backend reads the plate → match → approve → backend pushes `ticket:updated` to the kiosk.
7. Truck returns → second weight → tolerance check → final slip prints.

## 4. Outside services and API keys

We need accounts on 7 services. Only the backend holds secret keys; the browser never sees them. Check each provider's current free-tier limits before the demo.

| Service | Used for | Key / setting we get | Who uses it |
| --- | --- | --- | --- |
| **Plate Recognizer** (Snapshot API) | Reading number plates from kiosk and supervisor photos (supports Indian plates) | API token | Backend only |
| **Google Gemini API** (Flash model, free tier) | Reading invoice photos or PDFs into JSON: invoice no., material, supplier, transporter, weight, date | API key | Backend only |
| **Web Speech API** (built into Chrome) | Speech-to-text and text-to-speech, English (`en-IN`) and Hindi (`hi-IN`) | No key; needs internet (added last, optional) | Kiosk browser |
| **Supabase** | Cloud Postgres database + photo storage bucket | Database URL, service key | Backend only |
| **Railway** | Hosting the always-on backend | Project, env variables | — |
| **Vercel** | Hosting the frontend website | Project, env variables | — |
| **GitHub** | Code storage; Vercel and Railway deploy from it | Repository | — |

**Running cost:** everything runs on free plans except the backend. Railway needs its Hobby plan (about $5 a month) to stay always-on for the ESP32 and live updates; its 30-day trial credit covers a demo inside the first month. Use sample invoices, not real company invoices, on Gemini's free tier.

### Environment variables

Secrets go in `.env` files, which are never committed to Git. A `.env.example` file lists the names without values.

**Backend (`apps/server/.env`)**

- `DATABASE_URL` — Postgres connection
- `JWT_SECRET` — long random string to sign login cookies
- `PLATE_RECOGNIZER_TOKEN`
- `GEMINI_API_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `STORAGE_BUCKET` (or `STORAGE_DRIVER=local` in development)
- `DEVICE_TOKEN` — secret the ESP32 sends to prove it is our weighbridge
- `FRONTEND_ORIGIN` — the website address allowed to call the API (CORS)
- `PORT`, `TZ=Asia/Kolkata`; `CAM_FRONT_TOKEN`, `CAM_BACK_TOKEN` (one secret per ESP32-CAM)

**Frontend (`apps/web/.env.local`)**

- `NEXT_PUBLIC_API_URL` — backend address, e.g. `https://trinetra-api.up.railway.app`
- `NEXT_PUBLIC_SOCKET_URL` — same server, for live events

**ESP32 (`secrets.h`, not committed)**

- Wi-Fi name and password, backend WebSocket address, `DEVICE_TOKEN`

## 5. Data: defaults and database

All master data is hardcoded in one file, `packages/shared/seed/default-data.ts`, and loaded into the database by a seed script. To change a material type or unloading point before the demo, edit that file and run `pnpm db:seed`. There are no screens to edit it (that is the manager dashboard, out of scope).

### What the seed file contains

Values are taken from the store manager dashboard mockups (Material Type, Chainages Details, Unloading Point). Phone numbers are the mockups' sample numbers.

**Material types.** Where a threshold exists, the type is decided by the OCR invoice weight.

| Material | Type | Rule |
| --- | --- | --- |
| Cement Bags | Type 1 (Supervisor) | Always |
| Additive | Type 1 (Supervisor) | Always |
| Bitumen | Type 1 (Supervisor) | Always |
| Steel Bars | Type 1 (Supervisor) | Always |
| Steel Scrap | Type 2 / Type 3 | Above 1,000 kg → Type 2 (Store); 1,000 kg or less → Type 3 |
| Aggregate 20 mm | Type 2 / Type 3 | Above 500 kg → Type 2; 500 kg or less → Type 3 |
| Aggregate 10 mm | Type 2 / Type 3 | Above 500 kg → Type 2; 500 kg or less → Type 3 |
| Sand | Type 2 / Type 3 | Above 1,000 kg → Type 2; 1,000 kg or less → Type 3 |
| Bricks | Type 3 (Normal) | Always (assumed; the mockup only lists 500 kg or less) |

**Chainages and supervisors**

| Chainage | Location | Supervisor | Phone |
| --- | --- | --- | --- |
| CH-000+000 | Project Start Point | Amit Kumar | 9876543210 |
| CH-001+500 | Near Village Rampur | Suresh Yadav | 9876543211 |
| CH-003+250 | Bridge Approach Road | Ravi Singh | 9876543212 |
| CH-005+000 | Hill Section Area | Mahesh Patel | 9876543213 |
| CH-007+750 | Near Check Dam | Vikram Sharma | 9876543214 |
| CH-010+000 | Middle Section Point | Dinesh Verma | 9876543215 |
| CH-012+500 | Valley Crossing | Pankaj Gupta | 9876543216 |
| CH-015+000 | Near Quarry Area | Ajay Kumar | 9876543217 |
| CH-017+800 | Road Curve Point | Deepak Yadav | 9876543218 |
| CH-020+000 | Project End Point | Rohit Kumar | 9876543219 |

**Unloading rules** (trip range = total trips for that material)

| Material | Trip range | Unloading point | Supervisor |
| --- | --- | --- | --- |
| Cement Bags | 1–999 | Plant (location) | Amit Kumar |
| Steel Bars (added 2026-11-27) | 1–999 | CH-010+500, Middle Section Point | Vikram Sharma |
| Bitumen (added 2026-11-27) | 1–2 | CH-003+750, Bridge Approach Road | Suresh Yadav |
| Bitumen (added 2026-11-27) | 3–999 | CH-012+300, Valley Crossing | Pankaj Gupta |
| Aggregate 10 mm | 1–3 | CH-005+250, Hill Section Area | Ravi Singh |
| Aggregate 10 mm | 4–999 | CH-009+800, Near Quarry Area | Mahesh Patel |
| Aggregate 20 mm | 1–4 | CH-003+750, Bridge Approach Road | Suresh Yadav |
| Aggregate 20 mm | 5–999 | CH-010+500, Middle Section Point | Vikram Sharma |
| Sand | 1–999 | CH-012+300, Valley Crossing | Pankaj Gupta |
| Steel Scrap | 1–999 | Plant (location) | Dinesh Verma |
| **Default** (no rule, or trip past the range) | — | Plant (assumed) | Amit Kumar (assumed) |

**Users:** the 10 supervisors above (each logs in with a PIN); store officer **Ram (Sr. Manager)**; kiosk **WB-01**. Only Type 1 trucks need a supervisor. In the demo, Cement Bags and Additive reach **Amit Kumar** (Plant; Additive through the default), Steel Bars reach **Vikram Sharma**, and Bitumen reaches **Suresh Yadav** (trips 1–2) and then **Pankaj Gupta** (changed 2026-11-27). Other supervisors are shown on the slip as the contact at their unloading point.

**Transporters, vehicles, suppliers:** not in the mockups, so we use 3–4 sample names each and the plates printed on our truck models.

**Settings:** tolerance 0.5%, mismatch attempts 5, stable-weight window 3 seconds, weight wake-up threshold, ESP32 scale factor, weighbridge ID WB-01.

**Where the mockups disagree, and what we use**

- The Unloading page says "Cement", the Material Type page "Cement Bags" → treated as one material, Cement Bags.
- The Unloading page's type labels (e.g. Steel Scrap "Type 1", Aggregate 10 mm "Type 2") differ from the Material Type page → the **Material Type page wins**.
- Unloading-rule chainages and supervisors differ from the Chainages list (e.g. CH-005+250 is not in it) → the **unloading rule's** point and supervisor are used.
- The 500 / 1,000 kg thresholds are small for real trucks, so almost every real load becomes Type 2. For the demo, Type 3 sample invoices must show a weight at or below the threshold.

### Database tables

| Table | Holds | Key columns |
| --- | --- | --- |
| `users` | Supervisors, store officer, kiosk | name, role (KIOSK / SUPERVISOR / STORE), pin_hash, phone |
| `materials` | Material list | name, type, type2_above_kg, aliases_en, aliases_hi |
| `unloading_points` | CH-1, CH-6, On-site… | code, name, supervisor_id |
| `unloading_rules` | Trip ranges | material_id, trip_from, trip_to, point_id, is_default |
| `transporters`, `vehicles`, `suppliers` | Fleet and suppliers | name; vehicle plate (normalised, e.g. MH12AB1234), transporter_id |
| `tickets` | One per truck trip | ticket_no, plate, material_id, type, supplier, transporter, invoice_no, invoice_weight_kg, held_weight_kg, first_weight_kg, second_weight_kg, net_kg, variance_pct, trip_no, unloading_point_id, supervisor_id, status, language, driver_name, driver_phone, mismatch_attempts, is_demo, timestamps |
| `approvals` | Every request for a human decision | ticket_id, kind (STORE_TYPE2 / SUPERVISOR / HOLD / MISMATCH), status (PENDING / APPROVED / REJECTED), decided_by, reason, chosen_weight (HOLD), chosen_material (MISMATCH), photo_id, plate_read, plate_match, gps, decided_at |
| `photos` | Every image | ticket_id, kind (FRONT_PLATE / BACK_PLATE / INVOICE / SUPERVISOR / STORE), storage_path, sha256, taken_at |
| `ticket_events` | Timeline, never edited or deleted | ticket_id, type, actor (user, device or system), data (JSON), created_at |
| `settings` | Tolerance, attempts, demo switches | key, value |

**Small points**

- Weights are stored in **kilograms as whole numbers**; shown as `32,560 kg` (Indian number format)
- Times are stored in UTC and always shown in **IST**
- Ticket number format: `WB01-20261126-0001` (weighbridge, date, running number per day)
- Plates are normalised before matching: uppercase, spaces and dashes removed
- `ticket_events` is append-only: corrections add a new event, nothing is overwritten

## 6. Ticket lifecycle and business rules

Every truck trip is one ticket that moves through fixed statuses. Only the backend changes a status, and every change writes a timeline event. The kiosk and dashboards only show the status and send button presses.

### Ticket statuses

| Status | Meaning | Next status |
| --- | --- | --- |
| `STARTED` | Plate confirmed, driver answering questions and scanning invoice | `MISMATCH_PENDING`, `STORE_PENDING`, `READY_FOR_UNLOAD`, `ABANDONED` |
| `MISMATCH_PENDING` | Driver's material ≠ invoice material 5 times; store officer must decide | `STARTED` (store sets material) or `REJECTED` |
| `STORE_PENDING` | Type 2: first weight captured but **held**; truck waits aside | `READY_FOR_UNLOAD` (approved, weight saved) or `REJECTED` |
| `READY_FOR_UNLOAD` | First weight saved, slip printed, truck goes to unloading point. Type 1 also opens a supervisor request | `SUPERVISOR_PENDING` (Type 1) or `READY_FOR_SECOND` (Type 2, 3) |
| `SUPERVISOR_PENDING` | Type 1: waiting for supervisor plate-photo check | `READY_FOR_SECOND` or `BLOCKED` |
| `READY_FOR_SECOND` | Allowed to take the second weight | `HOLD_PENDING` or `COMPLETED` |
| `HOLD_PENDING` | Tolerance failed; store officer decides | `COMPLETED` or `REJECTED` |
| `COMPLETED` | Final slip printed | End |
| `REJECTED` | Store officer rejected; truck leaves | End |
| `BLOCKED` | Supervisor rejected; final slip blocked, store notified | End (store can review) |
| `ABANDONED` | Driver left before the first weight (10 minutes no activity) | End |

### Rules the backend applies

1. **Wake-up:** a truck is "on the bridge" when the ESP32 weight rises above the wake threshold **and** the position sensor says fully on platform.
2. **Position check:** if weight is present but position is not OK, the kiosk shows red, the ESP32 buzzer sounds and weighing is blocked until fixed.
3. **First or second visit:** after ANPR, if the plate has an open ticket (`READY_FOR_SECOND`, `SUPERVISOR_PENDING`, `BLOCKED`) the kiosk goes to the second-visit flow; otherwise a new ticket starts. Only **one open ticket per plate**. The front and back plates must read the same; if they still differ after 2 retries, the driver confirms the plate and the ticket is flagged "plate mismatch" for the store officer (a warning, not a block).
4. **Type:** from the material; if the material has a weight rule, use the **OCR invoice weight** (e.g. Steel Scrap above 1,000 kg → Type 2, else Type 3).
5. **Mismatch:** compare the driver's material with the invoice material (after alias matching). If different, ask again; on the 5th mismatch create a `MISMATCH` request for the store officer.
6. **Stable weight:** the weight is stable when it stays within ±10 kg for 3 seconds and the ESP32 stable flag is on. Only a stable weight can be captured.
7. **The backend captures the weight**, from the latest ESP32 reading it received. The browser never sends a weight number.
8. **Trip number and unloading point:** when the first weight is saved, trip number = completed-first-weights for that material + 1 (counted inside a database transaction so two trucks never get the same number). Find the rule whose range contains the trip number; if none, use the material's default point. The point's supervisor is assigned.
9. **Net weight** = first weight − second weight. If the result is zero or negative, the ticket goes to `HOLD_PENDING` with reason "weights not valid".
10. **Tolerance:** variance % = |net − invoice weight| ÷ invoice weight × 100. Pass if ≤ 0.5%. Fail → `HOLD_PENDING` and a `HOLD` request to the store officer.
11. **Supervisor plate match:** the plate read from the supervisor's photo must equal the ticket plate after normalising. Up to 3 photos; then the supervisor can reject or approve as "manual check" with a note (marked on the timeline).
12. **Store decision on HOLD:** approve with **measured net weight** or **invoice weight**, or reject. The chosen weight is printed on the final slip.
13. **Duplicate invoice:** if the same invoice number from the same supplier was used before, the timeline and store officer get a warning (not a block, for the prototype).
14. **Every step writes a `ticket_events` row**: who (device, user or system), what, when, and data.

## 7. API list

Three kinds of messages: **REST** for actions, **Socket.IO events** for live news, and a **device WebSocket** for the ESP32. Every action is a REST call (easy to check, retry and test); live events only announce that something changed.

### REST endpoints (backend, `/api/...`)

All bodies and answers are JSON (photos are `multipart/form-data`). Errors always look like `{ "error": { "code": "WRONG_STAGE", "message": "..." } }`.

| Method + path | Who | Does |
| --- | --- | --- |
| `GET /api/health` | Anyone | Server and database are up |
| `POST /api/auth/login` | All | Username + PIN → sets login cookie |
| `POST /api/auth/logout` | All | Clears the cookie |
| `GET /api/auth/me` | All | Who is logged in, role |
| `GET /api/master` | Kiosk | Materials (with aliases), suppliers, transporters for screens and voice matching |
| `GET /api/kiosk/state` | Kiosk | Current weight, position, ESP32 online, Type 2 "ready to print" list |
| `POST /api/anpr` | Kiosk | Asks both ESP32-CAMs for a photo and waits for them (or uses the demo plate) → both plates, match result, open ticket if any |
| `POST /api/tickets` | Kiosk | Start a ticket: plate, language, photo ids |
| `GET /api/tickets/:id` | Kiosk, supervisor, store | Full ticket with status and timeline |
| `POST /api/tickets/:id/upload-link` | Kiosk | Creates a one-time invoice upload link (shown as a QR), valid 10 minutes |
| `PATCH /api/tickets/:id/details` | Kiosk | Material, supplier, transporter, driver name, phone; runs the mismatch check |
| `POST /api/tickets/:id/first-weight` | Kiosk | Backend captures the stable weight; Type 2 → holds it and opens a store request |
| `POST /api/tickets/:id/second-weight` | Kiosk | Captures second weight, net, tolerance; may open a HOLD request |
| `POST /api/tickets/:id/discard-weight` | Kiosk | "Weigh again" before confirming |
| `POST /api/tickets/:id/printed` | Kiosk | Logs that a slip was printed (first, final, reprint) |
| `GET /api/supervisor/tickets` | Supervisor | My Type 1 trucks, filter by status |
| `POST /api/supervisor/tickets/:id/photo` | Supervisor | Live photo + GPS → plate read + match result |
| `GET /api/store/requests` | Store | Pending and past requests (Type 2, HOLD, mismatch, blocked) |
| `POST /api/approvals/:id/decide` | Supervisor, store | Approve / reject + reason; store adds chosen weight (HOLD) or material (mismatch) |
| `GET /api/photos/:id` | Logged-in users | Short-lived link to view a photo |
| `GET /api/public/tickets/:token` | Anyone with the QR | Read-only ticket and timeline, found only by its random token (no phone numbers, ids, bill or staff photos) |
| `GET /api/live/summary` | Anyone | Counts only. Built in Phase 8; **no page uses it** (no `/live` page) |
| `GET/PUT /api/demo/settings` | Store officer, or kiosk + admin PIN | Demo switches: kiosk plate reading, supervisor plate check, bill reading |
| `GET /api/demo/overview` | Store officer, or kiosk + admin PIN | Usage meters and device status |
| `GET /api/demo/master-data` | Store officer, or kiosk + admin PIN | The seeded rules, read-only |
| `GET /api/demo/status` | Any login | Is a demo mode on? (the DEMO badge) |
| `POST /api/demo/weight` | Kiosk + admin PIN only | Set a simulated weight, stable and position flags |
| `POST /api/demo/reset` | Store officer, or kiosk + admin PIN | Delete demo tickets, reset trip counters |

**Invoice upload from the driver's phone** uses two more endpoints with no login, protected by the one-time code instead: `GET /api/upload/:code` (checks the code, shows the plate so the driver knows it is his truck) and `POST /api/upload/:code` (photo or PDF up to 8 MB → Gemini → fields saved on the ticket → live event `invoice:read` to the kiosk). Codes are stored hashed in an `upload_links` table (ticket, expiry, used time) and work once.

### Live events (Socket.IO)

After login, each screen joins its own "room" so it only gets its own news: `kiosk`, `supervisor:<userId>`, `store`, `live`.

| Event | Sent to | Carries |
| --- | --- | --- |
| `hw:weight` | kiosk | kg, stable, position OK — about 5 times a second |
| `hw:status` | kiosk, live | ESP32 online / offline |
| `truck:arrived` | kiosk | A truck is on the bridge (wake up) |
| `ticket:updated` | kiosk, owner supervisor, store, live | Ticket id + new status |
| `approval:new` | the one supervisor, or store | New request to decide (with sound) |
| `approval:decided` | kiosk, store, supervisor | Result of a decision |
| `kiosk:ready` | kiosk | Type 2 ticket approved; driver can print slip |
| `demo:changed` | kiosk, supervisor, store | A demo switch changed: show or hide the DEMO badge |

The `live` room stays in the backend, but no page joins it (there is no `/live` page). The ticket page needs no room: it asks again every 5 seconds.

If the connection drops, Socket.IO reconnects by itself; on reconnect, each page reloads its data once so nothing is missed.

### ESP32 messages (device WebSocket `/device`)

The ESP32 connects to `wss://<backend>/device` with the `DEVICE_TOKEN` in a header. Messages are small JSON.

| Direction | Message | Meaning |
| --- | --- | --- |
| ESP32 → backend, every 200 ms | `{"t":"w","kg":32560,"stable":true,"pos":true}` | Weight (already scaled to truck kg), stable flag, position OK |
| ESP32 → backend, every 5 s | `{"t":"hb"}` | Heartbeat |
| Backend → ESP32 | `{"t":"light","c":"green"}` | Traffic light: green / red / orange |
| Backend → ESP32 | `{"t":"display","text":"Go to CH-6"}` | Show text on the hardware display |
| Backend → ESP32 | `{"t":"buzz","ms":1000}` | Buzzer for position alarm |
| Backend → ESP32 | `{"t":"tare"}` | Zero the scale (empty bridge only) |

**ESP32-CAM messages.** Each camera connects to the same `/device` endpoint with its own token and says which one it is (`front` or `back`). Backend → camera: `{"t":"snap","id":"<photo-id>"}`. The camera takes a JPEG with its flash LED on and uploads it with `POST /api/device/photo/<photo-id>`. If no photo arrives within 5 seconds, the backend asks once more, then the kiosk offers the plate keypad. The kiosk does not show live camera video (an HTTPS page cannot show the camera's plain-HTTP stream); it shows each photo the moment it arrives.

No message for 3 seconds = ESP32 offline: the kiosk shows "Weighbridge offline" and weighing is blocked unless demo weight is switched on.

## 8. Weighbridge kiosk website (`/kiosk`)

The kiosk is designed so a driver who has never used a computer can finish alone: one question per screen, everything spoken, answer by voice or by tapping a big tile. It follows the screens in our weighbridge UI PDF, simplified.

### Design rules

- **One screen = one sentence + one action.** No scrolling on the main screens.
- **Big:** text at least 32 px (headings 56 px+), every button at least 96 px tall, tiles fill the screen width
- **Colour always comes with an icon and a word:** green ✓ Go, orange ⏳ Wait, red ✕ Stop (works for colour-blind drivers too)
- **Yes / No** is always two giant buttons: green ✓ left, red ✕ right, same place on every screen
- **No keyboard.** Only a big number pad for phone number, and a plate keypad as last fallback
- **Numbers stay in 0–9 digits** in both languages, weights as `32,560 kg`
- **Fixed landscape layout** for a 1920×1080 or 1366×768 touchscreen
- **On every screen:** top bar with Trinetra logo, step dots (●●○○○), live weight, weighbridge light; bottom bar with 🔊 **Repeat**, **हिं / EN** switch, **Help** (alerts the store officer), **Start over** (asks to confirm)
- **Never stuck:** if voice fails, tiles are there; if a camera fails, a fallback appears; if nothing happens for 60 s, the question is repeated; after 3 minutes, "Start over?"

### Screens: first visit

1. **Ready (idle).** Big green circle: "Weighbridge ready — drive on". Below it, a "Ready to collect" list of approved Type 2 / HOLD trucks (tap your plate to see your slip). Red "Busy" when a truck is being weighed.
2. **Language.** Wakes when the ESP32 reports a truck. Two giant buttons: **English** and **हिंदी**. Spoken in both: "Choose your language / अपनी भाषा चुनें". Everything after is in that language.
3. **Position check** (only appears if needed). Red screen with a truck outline: "Move fully onto the bridge." Buzzer on the model. Continues by itself when the position is OK.
4. **Number plate.** "Reading your number plate…" — the front and back photos appear on screen as they arrive. The front and back cameras each take a photo automatically and both plates are read. Then: big plate **MH 12 AB 1234** — "Is this your truck?" ✓ / ✕. On ✕ it retries (up to 3), then the driver speaks or types the plate on a big keypad (marked "manual" on the timeline). If the plate has an open ticket → second visit (screen 12).
5. **Invoice upload.** "Scan this QR with your phone and upload your invoice." A big QR code and 3 picture steps: scan → take a photo or choose the PDF → send. The phone page opens in the driver's language with two big buttons: **Take photo** (opens the phone camera) and **Choose file** (photo or PDF, e.g. from WhatsApp). The moment it arrives, the kiosk shows "Reading invoice…" and then the filled values to confirm or correct by tapping. If reading fails, the driver uploads again or continues and the missing values are asked one by one. No phone? **Help** sends the store officer a request and he uploads it from his phone.
6. **Material.** "Which material are you carrying?" Big tiles of materials (name + picture) and, once voice is added, a big 🎤 button. The answer is compared with the invoice. If different: "This does not match your invoice. Please check and tell again." On the 5th mismatch: "Please go to the store office" and the store officer is alerted.
7. **Supplier.** Pre-filled from the invoice: "Supplier: Shree Ram Crushers — correct?" ✓ / ✕. ✕ → choose from tiles or speak.
8. **Transporter.** Pre-filled from the vehicle list → confirm the same way.
9. **Driver phone and name.** 10-digit phone on a big number pad (or speak the digits); name by voice (optional).
10. **Check.** All answers on one screen in large text — "Is everything correct?" ✓ / **Change** (tap any line to fix it).
11. **Weighing.** Huge live weight number, "Please stay still". A ring fills over 3 seconds while the weight is stable, then the weight is captured. Shows **32,560 kg** — ✓ **Correct** / ↻ **Weigh again**.
12. **Result**, depending on type:
    - **Type 1 and 3:** huge "Go to **CH-6**", supervisor name and phone. The first slip appears on screen with a Print button. Light turns orange, the hardware display shows "Go to CH-6", back to Ready after 15 s.
    - **Type 2:** "Please move aside and wait. The store officer is coming." Back to Ready when the truck leaves the bridge. When the officer approves, the kiosk announces "MH12AB1234, your slip is ready" and the plate appears in the Ready list. If rejected, the list shows "Not approved — please leave" for 10 minutes.
    - **Mismatch:** "Please go to the store office", same waiting behaviour as Type 2.

### Screens: second visit

13. **Welcome back.** After plate check, the kiosk shows the trip summary and checks the status:
    - Waiting for supervisor → orange "Waiting for supervisor approval. Please move aside." Updates live; announced when approved.
    - Blocked → red "Your truck was not approved. Go to the store office."
    - Ready → continue.
14. **Second weighing.** Same as screen 11.
15. **Final result.**
    - **Pass:** final slip summary (both weights, net, variance), appears on screen with a Print button. "Thank you, drive safely." Light orange, display shows "Thank you" → Ready.
    - **Tolerance fail:** "Weight does not match the invoice. Please go to the store office." After the store decision, the plate appears in the Ready list to print the final slip.

### Behaviours behind the screens

- If the truck leaves the bridge before the first weight is saved, the ticket stays `STARTED` for 10 minutes so the driver can come back and continue.
- Front and back cameras read the plates; invoices come from the driver's phone through the QR upload. Which camera is front and which is back is set once in demo settings.
- The kiosk is logged in once in the morning with the kiosk PIN; the driver never logs in.

## 9. Voice module (English + Hindi)

Voice runs inside the kiosk's Chrome browser with the Web Speech API: the kiosk speaks every instruction and listens for answers. It needs internet (Chrome sends audio to Google's speech service) and microphone permission.

**Built last, optional.** Until the voice phase, the kiosk runs fully by touch; every voice feature below already has a touch equivalent.

### Speaking (text-to-speech)

- Uses `speechSynthesis` with language `en-IN` or `hi-IN` and the clearest installed voice (Chrome's "Google हिन्दी" for Hindi)
- Every sentence comes from the translation files, with blanks filled in: "Go to {point}" → "Go to CH-6"
- Plates are spoken letter by letter ("M H 1 2 A B 1 2 3 4"); weights as numbers with "kilogram"
- Speed slightly slower than normal (0.9) for clarity
- A new screen stops the old sentence first, so voices never overlap
- 🔊 Repeat button on every screen
- **Fallback:** if the kiosk computer has no good Hindi voice, we record the fixed sentences once as audio files and play those; only names and numbers use live speech

### Listening (speech-to-text)

- Uses Chrome's `SpeechRecognition` in the chosen language, showing the words live on screen while the driver speaks
- Listening starts by itself **after** the kiosk finishes speaking (so it never hears its own voice), for about 6 seconds, with a pulsing 🎤. The driver can also tap 🎤 to speak again
- Asks for 5 possible interpretations and picks the best match

### Understanding the answer

1. Clean the text: lowercase, remove punctuation, convert number words in both languages ("bees" / "बीस" → 20, "das" → 10)
2. Match against the allowed answers for that screen with Fuse.js (material aliases, supplier names, transporter names)
3. **Yes words:** yes, yeah, haan, हाँ, ji, sahi, theek. **No words:** no, nahin, नहीं, galat
4. **Phone digits:** spoken digits in Hindi or English, including "double" and "triple"
5. Always read back before saving: "You said 20 mm Aggregate. Correct?"
6. Not understood twice → "Please tap your answer" and the tiles are highlighted

### Small points

- Use a **USB or directional microphone** near the driver; laptop mics pick up site noise
- Chrome must be allowed to play sound without a tap (kiosk launch setting, section 13)
- Hindi sentences must be checked by a native speaker before the demo
- Voice can be switched off in demo settings; the kiosk still works fully by touch

## 10. Supervisor website (`/supervisor`)

A phone-first web page where the supervisor verifies Type 1 trucks at the unloading point by photographing the number plate; the backend reads it and compares it with the plate read at the weighbridge.

### Pages

1. **Login:** username + 4–6 digit PIN on a big keypad. Stays logged in for the shift (12 hours).
2. **My trucks:** only Type 1 trucks sent to this supervisor's unloading points. Tabs: **Waiting** (default), **Done**. Each card: plate (big), material, invoice weight, unloading point, time since first weight. New trucks appear instantly with a sound and vibration. A count badge shows how many are waiting.
3. **Verify truck:** opens one card.
   - Top: the weighbridge's truck photo and plate close-up, plate text, material, supplier
   - **Take live photo** opens the phone's back camera **inside the page** (live video, then a capture button). There is no file picker, so gallery photos are impossible
   - "Reading plate…" → result side by side: weighbridge plate vs. photo plate
   - **✓ MATCH** (green) → **Approve** button becomes active
   - **✕ NO MATCH** (red) → **Retake photo** (up to 3), then **Reject** or **Approve as manual check** (note required)
   - **Reject** asks for a reason: Wrong vehicle / Wrong material / Bad quality / Other (+ note)
4. **Done list:** today's decisions with result, time and photo.

### What happens on a decision

- Saved with photo, plate read, match result, phone GPS (if allowed), time and supervisor name
- **Approve** → ticket becomes `READY_FOR_SECOND`; the kiosk is told instantly and announces it
- **Reject** → ticket becomes `BLOCKED`; the store officer gets an alert; the final slip can never print
- A decision cannot be changed afterwards

### Small points

- The camera only works on **HTTPS** pages (section 13)
- Photos are compressed on the phone to about 1,600 px wide before upload, so slow site networks still work
- If the upload fails, the page keeps the photo and shows **Try again**; nothing is lost

## 11. Store officer website (`/store`)

A phone-first web page where the store officer receives every request that needs the store and decides with one tap.

### Pages

1. **Login:** same as supervisor.
2. **Requests:** tabs **Pending** (default) and **Done**, newest first, live with sound and vibration. Each card has a coloured type badge:

   | Request | When it arrives | Approve does | Reject does |
   | --- | --- | --- | --- |
   | **Type 2 check** | First weight held at the kiosk | Saves the held first weight; slip ready at kiosk | Ticket `REJECTED`; truck told to leave |
   | **HOLD** (tolerance) | Net weight differs from invoice by more than 0.5% | Officer picks **Measured net** or **Invoice weight**; final slip ready | Ticket `REJECTED` |
   | **Mismatch** | Driver's material ≠ invoice 5 times | Officer picks the correct material; driver continues at kiosk | Ticket `REJECTED` |
   | **Blocked by supervisor** | Supervisor rejected a Type 1 truck | For information (reason and photo shown) | — |
   | **Driver help** | Driver pressed Help at the kiosk, or front and back plates did not match | Mark as handled | — |

3. **Request detail:** truck and plate photos, invoice photo and extracted values, weights so far; for HOLD the net, invoice weight, difference in kg and variance %. Optional **Take photo** (same live camera as supervisor). Big **✓ Approve** and **✕ Reject** (reason required).
4. **Done list:** today's decisions.

### What happens on a decision

- Saved with officer name, time, reason, chosen weight or material, and any photo
- The kiosk is told instantly; the plate appears in the kiosk's "Ready to collect" or "Not approved" list and is announced
- A decision cannot be changed afterwards

## 12. Shared pages

### Home (`/`)

A simple landing page in the kiosk's dark style: the Trinetra logo, one line about what Trinetra does, three big cards (**Weighbridge kiosk**, **Supervisor**, **Store officer**), each opening its page, a small "How it works" strip (truck arrives → plate read → bill read → weighed → verified → slip), and the English / Hindi switch. The kiosk opens `/kiosk` directly.

### Slips

Shown on screen as a slip, labels in English + the driver's language. A Print button opens the browser print dialog (no printer is used in the prototype; Save as PDF works).

| First slip | Final slip |
| --- | --- |
| Ticket number + QR code | Ticket number + QR code |
| Date, time (IST) | First and second weight with times |
| Plate, transporter, driver phone | Net weight, invoice weight, variance %, PASS / approved by store |
| Material, type, supplier, invoice no. and weight | Who approved (supervisor / store), when |
| First weight | Unloading point used |
| **Go to: CH-6**, supervisor name and phone | "Reprint" marked if printed again |

### Ticket page (`/t/<token>`, opened by the QR)

Public, read-only, made for a phone, no login. The address holds a long random **token**, not the ticket number, so nobody can step through other tickets; a wrong token shows "Ticket not found".

- Ticket number, plate, material, type, invoice number and weight, first, second and net weight, difference %, status, unloading point name, and a small front photo of the truck
- A timeline of every step with its time: arrived, plate read, bill read, first weight, verified by the supervisor / approved by the store, second weight, completed / rejected
- Never shown: phone numbers, PINs, internal ids, the bill picture, staff photos. Staff are named by name and role only
- A **Print** button with a clean print layout; English and Hindi
- While the visit is going on, the page asks again every 5 seconds

### No live summary page, no future-features page

Decided 2026-11-28: there is no `/live` page and no future-features page.

### Demo settings (`/settings`)

For the **store officer** (there is no admin role; the server checks the role).

- **Kiosk plate reading:** Real / Pick
- **Supervisor plate check:** Real / Pick (its own switch; Real unless switched)
- **Bill reading:** Real / Pick
- When a switch is on Pick: which plate and which sample invoice
- A small **DEMO** badge on the weighbridge, supervisor and store pages while any demo replacement is on
- **Usage:** Plate Recognizer calls this month (of 2,500) and Gemini calls today, with a warning from 80%
- **Devices:** the main ESP32 and both cameras, with when each was last heard
- **Reset demo data:** deletes demo tickets and resets trip counters; the word RESET must be typed. Users and master data are never touched
- The seeded rules, read-only: materials with their type rules, chainages and supervisors, unloading rules, tolerance

Every ticket made while any switch is on Pick (or the weight is simulated) is tagged "demo". The simulated weight is not on this page: it needs the kiosk login and the admin PIN. Tare, test photos and voice switches are not built.

## 13. Small but important details

These are the things that usually break a demo if forgotten.

### HTTPS, camera and microphone

- Browsers allow camera and microphone **only on HTTPS** pages (or `localhost`). Phones opening the laptop by its IP (`http://192.168.x.x`) will get **no camera**. So: use the deployed HTTPS site on phones, or for local testing make local HTTPS certificates with **mkcert**.
- Each device asks once for camera / microphone permission; we allow it during setup, not in front of investors.

### Login cookies across two hosts

- The frontend (Vercel) calls `/api/...` on its own address, and Next.js **forwards** it to the backend (a "rewrite"). The browser sees one site, so the login cookie just works.
- Socket.IO connects to the backend directly; it proves who you are with a short-lived token from `GET /api/auth/socket-token`.
- We use the free Vercel and Railway addresses (no custom domain). A custom domain could be added later, e.g. `trinetra.<domain>` for the site and `api.trinetra.<domain>` for the backend.

### Kiosk computer setup

- Chrome starts automatically in **kiosk mode** with: `--kiosk` (full screen, no address bar), `--kiosk-printing` (only if a printer is added later), `--autoplay-policy=no-user-gesture-required` (voice can speak before the first tap)
- Sleep, screensaver and Windows updates off during the demo
- No printer needed; the Print button opens the print dialog
- Volume high; USB mic set as default input once voice is added

### Security (simple, but real)

- PINs stored hashed (bcrypt); 5 wrong PINs → 1-minute lock
- Every API checks the role (a supervisor cannot approve store requests, the kiosk cannot approve anything)
- ESP32 must send the device token; other devices cannot send weights
- Photos only through short-lived links; uploads limited to images under 8 MB
- All inputs checked with Zod; secure headers on the backend; CORS allows only our website

### Reliability

- Buttons disable while a request is running, and each action carries a request id, so a double tap never saves two weights
- Socket.IO and the ESP32 both reconnect by themselves; pages reload their data after reconnecting
- Everything is saved in the database, so a server restart loses nothing
- Railway restarts the backend automatically if it crashes (health check on `/api/health`)

### Display

- Times always in IST; weights in kg with Indian commas; plate shown spaced (MH 12 AB 1234)
- Kiosk tested in Chrome only; supervisor and store pages tested on Android Chrome and iPhone Safari

## 14. Step-by-step implementation plan

17 phases, 120 steps, from installing tools to the deployed website. Each phase ends with a **Done when** check; we do not start the next phase until it passes. Claude builds each step, runs the tests, and commits to Git after every step, so any step can be undone.

### Folder structure

```
trinetra-prototype/
├─ apps/
│  ├─ web/            Next.js website (home, kiosk, supervisor, store, ticket page, demo settings)
│  └─ server/         Fastify backend (REST, Socket.IO, ESP32 WebSocket)
├─ packages/
│  └─ shared/         Zod schemas, types, statuses, rules, voice matching, seed data
├─ firmware/
│  └─ esp32/          Arduino code for the weighbridge model
├─ scripts/           ESP32 simulator, demo helpers
├─ tests/e2e/         Playwright demo scenarios
├─ docker-compose.yml Local Postgres
└─ README.md          How to set up and run
```

### Phase 0 — Tools, accounts and demo items

1. Install **Node.js 22 LTS**; check with `node -v`.
2. Turn on **pnpm** with `corepack enable`; check with `pnpm -v`.
3. Install **Git**, **VS Code**, **Docker Desktop**, **Google Chrome**.
4. Install **Arduino IDE 2**, the **ESP32 board package**, and the USB driver for the ESP32 board (CP210x or CH340).
5. Create accounts: GitHub, Supabase, Vercel, Railway, Plate Recognizer, Google AI Studio (Gemini).
6. Create the API keys (Plate Recognizer token, Gemini key) and keep them in a password manager.
7. Gather demo items: number plates printed on the truck models, 3–4 printed sample invoices, front and back cameras (ready), speaker, touchscreen laptop, 2 phones, mobile hotspot.

**Done when:** every tool opens, all accounts exist, keys are saved.

### Phase 1 — Project setup

8. Create a private GitHub repository `trinetra-prototype` and clone it.
9. Create the folders above and `pnpm-workspace.yaml`.
10. Add root scripts: `dev`, `build`, `test`, `lint`, `db:migrate`, `db:seed`.
11. Add a shared strict TypeScript config.
12. Add ESLint, Prettier, `.editorconfig`, `.gitignore` (node_modules, `.env*`, `.next`, `dist`, `uploads`).
13. Add `.env.example` for server and web (section 4).
14. Create the Next.js app in `apps/web` (TypeScript, Tailwind, App Router) and add shadcn/ui.
15. Create the Fastify app in `apps/server` (run with `tsx` in development, build with `tsup`).
16. Create `packages/shared` and import it from both apps.
17. Make `pnpm dev` start both: website on port 3000, backend on port 4000.
18. Write the README (how to install and run) and push the first commit.

**Done when:** `localhost:3000` shows a page and `localhost:4000/api/health` answers `ok`.

### Phase 2 — Database

19. Add `docker-compose.yml` with Postgres 16 and a data volume; start it.
20. Configure Drizzle with `DATABASE_URL`.
21. Write all tables from section 5, with enums for status and kinds.
22. Add indexes: unique ticket number, unique plate per vehicle, **only one open ticket per plate**.
23. Generate and run the first migration.
24. Write `default-data.ts` (materials, points, rules, users, fleet, settings).
25. Write the seed script (hashes PINs, can reset).
26. Run the seed and check the rows in Drizzle Studio.

**Done when:** all tables exist with the demo data.

### Phase 3 — Backend foundation

27. Load and check environment variables with Zod; the server refuses to start if one is missing.
28. Register Fastify plugins: CORS, cookie, JWT, multipart (8 MB limit), security headers, rate limiting, pino logging.
29. Add one error handler that always returns the standard error JSON.
30. Build login (PIN check + 5-try lock), logout, `me`, and socket token.
31. Add a role guard used by every route.
32. Make `/api/health` also check the database.
33. Build the storage service with two drivers: local folder and Supabase Storage.

**Done when:** each role can log in with an API client (Bruno or curl) and is refused on other roles' routes.

### Phase 4 — Business rules (with tests)

34. `normalizePlate` and `formatPlate`.
35. `classifyType(material, invoiceKg)`.
36. `resolveUnloadingPoint(material, tripNo, rules)` with default point.
37. `computeNet` and `checkTolerance` (0.5%).
38. `isStable` for the 3-second window.
39. Voice matching helpers: aliases, yes/no words, spoken digits (in `shared`, used by the kiosk).
40. Ticket state machine: table of allowed moves and `transition()`, which refuses wrong moves.
41. Unit tests with Vitest for all of these, including edge cases: zero weight, negative net, invoice exactly at a threshold (500 / 1,000 kg), trip number past every range, plates with spaces and dashes.

**Done when:** all unit tests pass.

### Phase 5 — ESP32 and hardware link

42. Firmware: Wi-Fi connect with auto-reconnect.
43. Read the HX711; tare on start.
44. Calibrate with known weights; store the calibration factor and the truck scale factor in the firmware config.
45. Stable detection on the ESP32 (moving average and small spread).
46. Position sensors (e.g. one IR sensor at each end of the bridge) → position OK flag.
47. Outputs: traffic light LEDs, buzzer, and the hardware display (shows text sent by the backend).
48. WebSocket client to `/device` with the device token: send weight every 200 ms, heartbeat every 5 s, act on commands.
49. Backend `/device` endpoint: check token, keep the latest reading in memory, mark offline after 3 s, forward `hw:weight` to the kiosk about 5 times a second.
50. Write an ESP32 simulator script so we can develop without the model plugged in. ESP32-CAM firmware (front and back): Wi-Fi, connect to `/device` as front or back, on "snap" take a JPEG with flash and upload it over HTTPS; tune resolution and JPEG quality for plate reading; give each board a stable 5 V supply so it does not reset.
51. Test the real model: weight on the bridge shows in `GET /api/kiosk/state`.

**Done when:** a weight placed on the model shows in the backend within half a second; lights, buzzer and display respond to commands.

### Phase 6 — Real-time events

52. Attach Socket.IO to the backend; accept connections only with a valid socket token.
53. Put each connection in its room (kiosk, supervisor:id, store, live).
54. Add one helper that sends events **after** the database change is saved.
55. Frontend hook: connect, reconnect by itself, reload data after reconnecting.

**Done when:** an event sent from the backend appears in two browser tabs at once.

### Phase 7 — ANPR and invoice OCR

56. ESP32-CAM photo request + upload endpoint, and image pipeline: resize and compress with sharp, compute SHA-256, save to storage.
57. Plate Recognizer client (region India), take the best plate and confidence, 8-second timeout, one retry; if it finds no plate (small model plates), ask Gemini to read the plate from the same photo.
58. Gemini invoice reader: send the image, ask for strict JSON, check it with Zod; unreadable fields come back empty, never guessed; convert tonnes to kg.
59. Demo replacements: pick a plate, pick a sample invoice.
60. Test with our printed plates and sample invoices; adjust camera position and lighting.

**Done when:** at least 9 of 10 plate reads are correct on our models, and all sample invoices read correctly.

### Phase 8 — Ticket APIs

61. `POST /api/anpr` (also finds an open ticket for the plate).
62. Start and read tickets.
63. Invoice upload: one-time link for the kiosk QR, and the phone upload endpoints (image or PDF up to 8 MB, 10-minute expiry) → Gemini → fields saved → kiosk told live.
64. Details endpoint with the mismatch counter and the 5th-attempt store request.
65. First weight: type rules, Type 2 hold + store request, trip number in a transaction, unloading point, supervisor request for Type 1.
66. Second weight: net, tolerance, HOLD request.
67. Discard weight and "slip printed".
68. Supervisor endpoints: my trucks, photo → plate read → match.
69. Decide endpoint: role check, status move, chosen weight or material.
70. Store requests list and driver-help requests.
71. Public timeline, live summary, demo endpoints.
72. A job every minute that marks old `STARTED` tickets `ABANDONED`.
73. Send light, buzzer and display commands: green when ready, red while weighing, orange when done, with the next instruction on the hardware display.
74. API tests for every endpoint: success, wrong status, wrong role.

**Done when:** a script can run a complete truck journey of each type using only API calls.

### Phase 9 — Frontend foundation

75. Base layout, fonts (Noto Sans + Devanagari), Tailwind theme: colours, big sizes, kiosk and phone layouts.
76. Next.js rewrite so `/api/*` goes to the backend.
77. API client (one fetch wrapper with error messages) + TanStack Query.
78. Login pages and route protection per role.
79. Translation files `en.json`, `hi.json` and the `t()` helper; language saved per kiosk session.
80. Socket hook from phase 6 wired into the app.

**Done when:** each role can log in and sees its empty page; wrong roles are sent back to login.

### Phase 10 — Kiosk website

81. Kiosk shell: top bar, bottom bar, step dots, kiosk store (current screen, ticket id, answers).
82. Camera module: show the ESP32-CAM photos as they arrive, with each camera's online status.
83. Screen 1 Ready, with the "Ready to collect" list.
84. Screen 2 Language.
85. Screen 3 Position check.
86. Screen 4 Number plate (auto photo, confirm, retry, keypad fallback, open-ticket detection).
87. Screen 5 Invoice upload: QR on the kiosk, the phone upload page (Take photo / Choose file, in the driver's language), live update back to the kiosk.
88. Screens 6–9: one reusable question screen (big tiles) for material, supplier, transporter, phone and name; mismatch messages.
89. Screen 10 Check all answers.
90. Screen 11 Weighing: live weight, stability ring, confirm / weigh again.
91. Screen 12 Results for Type 1/3, Type 2 and mismatch.
92. Screens 13–15 second visit: status check, second weighing, final result.
93. Inactivity timers, Start over, Help button.
94. First and final slip layouts, QR code, Print button with print-friendly CSS.

**Done when:** a full first and second visit of every type works by touch, using the ESP32 simulator.

### Phase 11 — Voice (optional, built last, after Phase 16)

95. Speaking service: queue, stop on screen change, voice choice, speed.
96. Write every sentence in English and Hindi; native-speaker check.
97. Listening service: starts after speaking ends, 6 seconds, 5 alternatives, live caption.
98. Connect matching to every question (aliases, yes/no, digits, read-back).
99. Test on the kiosk computer with the USB mic in noise; record fallback audio if the Hindi voice is poor.

**Done when:** a full journey can be done by voice only, once in English and once in Hindi.

### Phase 12 — Supervisor website

100. My trucks list with live updates, sound and vibration.
101. Live camera component (back camera, capture, compress), shared with the store pages.
102. Verify page: photos, plate match, approve / reject / manual check.
103. Done list.

**Done when:** approving on a phone unlocks the kiosk in under 1 second.

### Phase 13 — Store officer website

104. Requests list with tabs, type badges, live updates, sound.
105. Detail page for each request type, with weight / material choice.
106. Done list.

**Done when:** all five request types work end to end with the kiosk.

### Phase 14 — Shared pages

107. Home page with the three role buttons.
108. Ticket page `/t/<token>`.
109. ~~Live summary page `/live`.~~ Dropped (2026-11-28): no `/live` page and no future-features page.
110. Demo settings page `/settings` (store officer login).

**Done when:** scanning the QR on the on-screen slip with a phone opens that ticket's page.

### Phase 15 — Testing

111. Run all automated tests (unit, API, the four Playwright demo scenarios) until all pass.
112. Run the device tests in section 15 on the real kiosk, phones and ESP32.
113. Fix everything found and run both again.

**Done when:** all tests pass twice in a row.

### Phase 16 — Deploy

114. **Supabase:** create the project; copy the database URL; create a private storage bucket `photos`.
115. Run migrations and the seed against the Supabase database.
116. **Railway:** new project from the GitHub repo, root `apps/server`, build and start commands, all backend env variables, health check `/api/health`, region closest to India (e.g. Singapore).
117. **Vercel:** import the repo, root `apps/web`, env variables, rewrite `/api` to the Railway address.
118. Use the free Vercel and Railway addresses (HTTPS is automatic); set `FRONTEND_ORIGIN`; check login cookies and CORS.
119. Put the `wss://` backend address and device token in the ESP32 secrets and flash it; connect it to the hotspot.
120. Smoke test the four demo scenarios on the deployed site with the real kiosk, two phones and the model; tag the release `v1.0-demo`. From now on, every push to `main` deploys automatically.

**Done when:** all four scenarios pass on the live website over the mobile hotspot.

## 15. Testing plan and demo-day checklist

### Automated tests

- **Unit tests (Vitest):** every business rule in phase 4 and the voice matching helpers
- **API tests:** every endpoint — success, wrong status, wrong role, bad input
- **End-to-end (Playwright):** the four demo scenarios in a real browser with the ESP32 simulator and demo ANPR/OCR

### The four demo scenarios

| # | Scenario | Investors see |
| --- | --- | --- |
| 1 | Type 3 truck, fully automatic | Plate read, invoice read, touch answers, two weights, final slip with no human involved |
| 2 | Type 1 truck, supervisor approves | Live plate photo on the phone matches; kiosk unlocks instantly |
| 3 | Fraud blocked | Supervisor photo shows a different plate (or the store rejects a Type 2 truck); final slip blocked |
| 4 | Tolerance fail | Net differs from invoice by more than 0.5%; HOLD; store officer decides on the phone |

### Device tests (by hand)

- [ ] Front and back cameras read every demo plate in the demo room's light
- [ ] Every sample invoice reads correctly when uploaded from a phone, as a photo and as a PDF, on Android and iPhone
- [ ] After the voice phase: full journey by voice only, in English and in Hindi, with background noise
- [ ] Supervisor live camera on Android Chrome and iPhone Safari; no way to pick a gallery photo
- [ ] Approve on phone → kiosk reacts in under 1 second
- [ ] Unplug the ESP32 → kiosk shows offline; switch to simulated weight → demo continues
- [ ] Turn off Wi-Fi briefly → everything reconnects by itself
- [ ] Print button opens the print dialog; QR on the on-screen slip opens the timeline
- [ ] Lights, buzzer and hardware display react at the right moments

### Demo-day checklist

- [ ] Charge laptop, phones, hotspot; bring chargers and a power strip
- [ ] Hotspot on; kiosk, phones and ESP32 connected; backend health check green
- [ ] Kiosk logged in, Chrome in kiosk mode, volume up
- [ ] Supervisor and store officer logged in on the two phones; sound on
- [ ] Tare the scale with the bridge empty
- [ ] Run **Reset demo data**, then one quick practice truck
- [ ] Demo settings page ready in case anything fails (simulated weight, pick plate, pick invoice)
- [ ] A recorded video of all four scenarios as the last backup

## 16. Risks and decisions to confirm

### Risks and their fallback

| Risk | What we do |
| --- | --- |
| Venue internet fails (ANPR, OCR, voice, backend all need it) | Bring our own hotspot; demo settings switch to pick-plate / pick-invoice; recorded video as last resort |
| Hindi voice sounds poor on the kiosk computer | Pre-recorded audio for fixed sentences |
| Speech not understood in a noisy room | USB mic close to the driver; tiles always available |
| Plate not read on the small truck models | Large, clear printed plates; fixed camera angle and light; pick-plate fallback |
| ESP32 disconnects | Auto-reconnect; simulated weight switch |
| Phone camera blocked | Always use the HTTPS site; allow permissions during setup |
| API free limits reached | Check limits early; keep test runs on demo mode |

**Biggest camera risk: ESP32-CAM image quality.** It has a small fixed-focus sensor, so plates on the model must be large and clearly printed, lit by the flash LED, at a fixed distance. We test plate reading on the real model early (phase 7); fallbacks are Gemini reading the plate, then the plate keypad, then pick-plate in demo settings.

### Decisions to confirm before we start

**Decided**

- [x] Hardware: load cells, position sensors, traffic lights, buzzer, display, front and back cameras; no barrier
- [x] Invoice OCR: Google Gemini
- [x] Voice: built last, optional
- [x] Cameras connect directly to the website/backend, not through the ESP32

**Also decided**

- [x] **Cameras:** ESP32-CAM (front and back), photos pushed to the backend
- [x] **Invoice:** uploaded from the driver's phone through a QR code on the kiosk (photo or PDF)
- [x] **Domain:** free Vercel and Railway addresses, no custom domain
- [x] **Printing:** no physical printer; slips are shown on screen with a Print button (browser print dialog, Save as PDF works)
- [x] **Voice and Hindi voice review:** set aside for now; Hindi screen text stays
- [x] **Demo date:** not fixed; we follow the phases in order
